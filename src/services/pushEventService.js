import { Op } from "sequelize";
import AppError from "../utils/AppError.js";
import { parseJsonField } from "../utils/jsonFields.js";
import { PUSH_EVENTS, PUSH_EVENTS_BY_KEY } from "../config/pushEvents.js";
import { createNotification } from "./notificationService.js";
import * as devicePushService from "./devicePushService.js";
import { isUserAdmin, listAdminUserIds } from "./userService.js";
import { getTenantPlan } from "./planService.js";
import { dayInShopTz } from "../utils/rentalDays.js";
import { liveTotalOf, owedAmount } from "../utils/invoiceBalance.js";
import { getPhoneAssistantPolicy } from "./phoneAssistantPolicyService.js";
import { renderForRecipient } from "./pushTemplateService.js";

const DEFAULT_TIMEZONE = "Asia/Colombo";
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ALLOWED_DIGEST_MINUTES = new Set([15, 30, 60]);

// In-memory digest queue per (tenantKey, userId)
const digestBuckets = new Map();

export const __resetPushDigestBucketsForTests = () => {
  digestBuckets.clear();
};

export const buildDefaultPushSettings = () => {
  const events = {};
  for (const ev of PUSH_EVENTS) {
    events[ev.key] = {
      enabled: Boolean(ev.default_enabled),
      min_amount: 0,
      recipient_role_ids: [],
      hide_customer_name: false,
      delivery: "instant",
    };
  }
  return {
    events,
    quiet_hours: { enabled: false, from: "21:00", to: "07:00" },
    include_amounts: true,
    notify_actor: false,
    digest_minutes: 30,
    daily_summary: {
      enabled: false,
      send_time: "18:00",
      recipient_role_ids: [],
      sections: {
        bills: true,
        payments: true,
        returns: true,
        due_tomorrow: true,
        overdue: true,
      },
    },
  };
};

export const mergePushSettings = (raw) => {
  const defaults = buildDefaultPushSettings();
  const parsed = raw && typeof raw === "object" ? raw : {};
  const rawEvents = parsed.events && typeof parsed.events === "object" ? parsed.events : {};

  const events = {};
  for (const ev of PUSH_EVENTS) {
    const base = defaults.events[ev.key];
    const entry = rawEvents[ev.key] && typeof rawEvents[ev.key] === "object" ? rawEvents[ev.key] : {};
    const minVal = ev.has_amount ? Number(entry.min_amount ?? base.min_amount) : 0;
    const roleIds = Array.isArray(entry.recipient_role_ids)
      ? [
          ...new Set(
            entry.recipient_role_ids
              .map((id) => Number(id))
              .filter((id) => Number.isFinite(id) && id > 0),
          ),
        ]
      : [];
    events[ev.key] = {
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : base.enabled,
      min_amount: Number.isFinite(minVal) && minVal >= 0 ? minVal : 0,
      recipient_role_ids: roleIds,
      hide_customer_name:
        typeof entry.hide_customer_name === "boolean"
          ? entry.hide_customer_name
          : base.hide_customer_name,
      delivery: entry.delivery === "digest" ? "digest" : "instant",
    };
  }

  const rawQuiet = parsed.quiet_hours && typeof parsed.quiet_hours === "object" ? parsed.quiet_hours : {};
  const fromStr = TIME_RE.test(String(rawQuiet.from || "")) ? String(rawQuiet.from) : defaults.quiet_hours.from;
  const toStr = TIME_RE.test(String(rawQuiet.to || "")) ? String(rawQuiet.to) : defaults.quiet_hours.to;

  const digestMinsRaw = Number(parsed.digest_minutes);
  const digestMinutes = ALLOWED_DIGEST_MINUTES.has(digestMinsRaw)
    ? digestMinsRaw
    : defaults.digest_minutes;

  const rawDaily =
    parsed.daily_summary && typeof parsed.daily_summary === "object"
      ? parsed.daily_summary
      : {};
  const rawSections =
    rawDaily.sections && typeof rawDaily.sections === "object" ? rawDaily.sections : {};
  const dailyRoles = Array.isArray(rawDaily.recipient_role_ids)
    ? [
        ...new Set(
          rawDaily.recipient_role_ids
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      ]
    : [];

  return {
    events,
    quiet_hours: {
      enabled: typeof rawQuiet.enabled === "boolean" ? rawQuiet.enabled : defaults.quiet_hours.enabled,
      from: fromStr,
      to: toStr,
    },
    include_amounts:
      typeof parsed.include_amounts === "boolean" ? parsed.include_amounts : defaults.include_amounts,
    notify_actor:
      typeof parsed.notify_actor === "boolean" ? parsed.notify_actor : defaults.notify_actor,
    digest_minutes: digestMinutes,
    daily_summary: {
      enabled:
        typeof rawDaily.enabled === "boolean"
          ? rawDaily.enabled
          : defaults.daily_summary.enabled,
      send_time: TIME_RE.test(String(rawDaily.send_time || ""))
        ? String(rawDaily.send_time)
        : defaults.daily_summary.send_time,
      recipient_role_ids: dailyRoles,
      sections: {
        bills:
          typeof rawSections.bills === "boolean"
            ? rawSections.bills
            : defaults.daily_summary.sections.bills,
        payments:
          typeof rawSections.payments === "boolean"
            ? rawSections.payments
            : defaults.daily_summary.sections.payments,
        returns:
          typeof rawSections.returns === "boolean"
            ? rawSections.returns
            : defaults.daily_summary.sections.returns,
        due_tomorrow:
          typeof rawSections.due_tomorrow === "boolean"
            ? rawSections.due_tomorrow
            : defaults.daily_summary.sections.due_tomorrow,
        overdue:
          typeof rawSections.overdue === "boolean"
            ? rawSections.overdue
            : defaults.daily_summary.sections.overdue,
      },
    },
  };
};

const readStoredPushSettings = (config) => {
  const custom = parseJsonField(config?.custom_settings, {});
  const pa = parseJsonField(custom?.phone_assistant, {});
  return mergePushSettings(parseJsonField(pa?.push, {}));
};

const parseMinutes = (hhmm) => {
  const m = TIME_RE.exec(String(hhmm || ""));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

export const isWithinQuietHours = (quietHours, now = new Date(), timezone = DEFAULT_TIMEZONE) => {
  if (!quietHours?.enabled) return false;
  const fromMin = parseMinutes(quietHours.from);
  const toMin = parseMinutes(quietHours.to);
  if (fromMin === null || toMin === null || fromMin === toMin) return false;

  const tz = timezone || DEFAULT_TIMEZONE;
  let hh = 0;
  let mm = 0;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    hh = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
    mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  } catch {
    hh = now.getUTCHours();
    mm = now.getUTCMinutes();
  }

  const currentMin = hh * 60 + mm;
  if (fromMin < toMin) {
    return currentMin >= fromMin && currentMin < toMin;
  }
  return currentMin >= fromMin || currentMin < toMin;
};

export const stripCurrencyAmounts = (text) => {
  if (!text) return "";
  return String(text)
    .replace(/\s*·\s*(?:LKR|Rs\.?)\s*-?[\d,]+(?:\.\d+)?/gi, "")
    .replace(/(?:LKR|Rs\.?)\s*-?[\d,]+(?:\.\d+)?\s*·\s*/gi, "")
    .replace(/(?:LKR|Rs\.?)\s*-?[\d,]+(?:\.\d+)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const redactCustomerName = (text, customerName = null) => {
  if (!text) return "";
  let out = String(text);
  if (customerName && String(customerName).trim()) {
    const clean = String(customerName).trim();
    const rx = new RegExp(escapeRegex(clean), "gi");
    out = out.replace(rx, "Customer");
  }
  return out.replace(/\s{2,}/g, " ").trim();
};

export const getPushSettings = async (models) => {
  const config = models?.TenantConfig?.findOne ? await models.TenantConfig.findOne() : null;
  return {
    settings: readStoredPushSettings(config),
    catalog: PUSH_EVENTS,
  };
};

export const updatePushSettings = async (models, payload = {}) => {
  if (payload.events && typeof payload.events === "object") {
    for (const key of Object.keys(payload.events)) {
      if (!PUSH_EVENTS_BY_KEY[key]) {
        throw new AppError(`Unknown push event key: ${key}`, 400);
      }
      const rule = payload.events[key];
      if (rule && rule.min_amount !== undefined && rule.min_amount !== null) {
        const num = Number(rule.min_amount);
        if (!Number.isFinite(num) || num < 0) {
          throw new AppError(`Invalid minimum amount for ${key}.`, 400);
        }
      }
      if (rule && rule.delivery !== undefined && !["instant", "digest"].includes(rule.delivery)) {
        throw new AppError(`Invalid delivery mode for ${key}.`, 400);
      }
    }
  }

  if (payload.quiet_hours) {
    if (
      (payload.quiet_hours.from !== undefined && !TIME_RE.test(String(payload.quiet_hours.from))) ||
      (payload.quiet_hours.to !== undefined && !TIME_RE.test(String(payload.quiet_hours.to)))
    ) {
      throw new AppError("Quiet hours must use HH:MM (24-hour) format.", 400);
    }
  }

  if (
    payload.digest_minutes !== undefined &&
    !ALLOWED_DIGEST_MINUTES.has(Number(payload.digest_minutes))
  ) {
    throw new AppError("digest_minutes must be 15, 30, or 60.", 400);
  }

  if (payload.daily_summary?.send_time !== undefined) {
    if (!TIME_RE.test(String(payload.daily_summary.send_time))) {
      throw new AppError("Daily summary send_time must use HH:MM (24-hour) format.", 400);
    }
  }

  const config = await models.TenantConfig.findOne();
  if (!config) {
    throw new AppError("Tenant config missing.", 500);
  }

  const custom = parseJsonField(config.custom_settings, {});
  const pa = parseJsonField(custom.phone_assistant, {});
  const current = readStoredPushSettings(config);
  const nextSettings = mergePushSettings({
    ...current,
    ...payload,
    events: {
      ...current.events,
      ...(payload.events || {}),
    },
    quiet_hours: {
      ...current.quiet_hours,
      ...(payload.quiet_hours || {}),
    },
    daily_summary: {
      ...current.daily_summary,
      ...(payload.daily_summary || {}),
      sections: {
        ...current.daily_summary.sections,
        ...(payload.daily_summary?.sections || {}),
      },
    },
  });

  await config.update({
    custom_settings: {
      ...custom,
      phone_assistant: {
        ...pa,
        push: nextSettings,
      },
    },
  });

  return { settings: nextSettings };
};

export const sendTestPush = async (models, userId) => {
  const title = "GearGrid Phone Assistant test";
  const body = "Push notifications are active on this device.";

  try {
    await createNotification(models, {
      userId,
      type: "info",
      category: "phone_assistant",
      title,
      message: body,
      payload: { type: "push_test" },
      link: "/profile?tab=notifications",
    });
  } catch {
    // Non-fatal in case in-app notification persistence fails
  }

  const res = await devicePushService.sendToUsers(models, [userId], {
    title,
    body,
    data: { type: "push_test" },
    channel: "bills",
  });

  return { reached: Number(res?.reached ?? res?.sent ?? 0) };
};

const getUserWithRoles = async (models, userId) => {
  if (!models?.User?.findByPk || !userId) return null;
  return models.User.findByPk(userId, {
    attributes: ["user_id", "is_active"],
    include: models.Role
      ? [
          {
            model: models.Role,
            attributes: ["role_id", "role_name", "hierarchy_level", "is_active"],
            through: { attributes: [] },
          },
        ]
      : [],
  });
};

const extractUserQuietHours = (rows = []) => {
  const hit = (rows || []).find((r) => r?.quiet_from && r?.quiet_to);
  if (hit) {
    return {
      enabled: true,
      from: String(hit.quiet_from),
      to: String(hit.quiet_to),
    };
  }
  return { enabled: false, from: null, to: null };
};

export const getUserPushPreferences = async (models, userId, device = null) => {
  const [{ settings }, user, rows] = await Promise.all([
    getPushSettings(models),
    getUserWithRoles(models, userId),
    models?.PushPreference?.findAll
      ? models.PushPreference.findAll({ where: { user_id: userId } })
      : Promise.resolve([]),
  ]);

  const userIsAdmin = isUserAdmin(user);
  const userRoleIds = new Set(
    (user?.Roles || [])
      .filter((r) => r.is_active !== false)
      .map((r) => Number(r.role_id)),
  );
  const rowByKey = new Map((rows || []).map((r) => [r.event_key, r]));

  const preferences = PUSH_EVENTS.map((ev) => {
    const rule = settings.events[ev.key];
    const eligible =
      userIsAdmin || rule.recipient_role_ids.some((rid) => userRoleIds.has(Number(rid)));
    const pref = rowByKey.get(ev.key);

    return {
      event_key: ev.key,
      group: ev.group,
      eligible,
      shop_enabled: Boolean(rule.enabled),
      has_amount: Boolean(ev.has_amount),
      shop_min_amount: Number(rule.min_amount || 0),
      enabled: pref ? Boolean(pref.enabled) : true,
      min_amount:
        ev.has_amount && pref && pref.min_amount !== null && pref.min_amount !== undefined
          ? Number(pref.min_amount)
          : null,
    };
  });

  return {
    preferences,
    quiet_hours: extractUserQuietHours(rows),
    ...(device ? { muted: Boolean(device.muted) } : {}),
  };
};

export const updateUserPushPreferences = async (models, userId, payload = {}, device = null) => {
  const items = Array.isArray(payload.preferences) ? payload.preferences : [];

  for (const item of items) {
    const meta = PUSH_EVENTS_BY_KEY[item?.event_key];
    if (!meta) {
      throw new AppError(`Unknown push event key: ${item?.event_key}`, 400);
    }
    if (item.min_amount !== undefined && item.min_amount !== null) {
      const num = Number(item.min_amount);
      if (!Number.isFinite(num) || num < 0) {
        throw new AppError(`Invalid minimum amount for ${item.event_key}.`, 400);
      }
    }
  }

  let hasQuietUpdate = false;
  let nextQuietFrom = null;
  let nextQuietTo = null;
  if (payload.quiet_hours && typeof payload.quiet_hours === "object") {
    hasQuietUpdate = true;
    if (payload.quiet_hours.enabled) {
      if (
        !TIME_RE.test(String(payload.quiet_hours.from || "")) ||
        !TIME_RE.test(String(payload.quiet_hours.to || ""))
      ) {
        throw new AppError("Personal quiet hours must use HH:MM (24-hour) format.", 400);
      }
      nextQuietFrom = String(payload.quiet_hours.from);
      nextQuietTo = String(payload.quiet_hours.to);
    }
  }

  const persist = async (t) => {
    const opts = t ? { transaction: t } : {};
    for (const item of items) {
      const meta = PUSH_EVENTS_BY_KEY[item.event_key];
      const nextMin =
        meta.has_amount && item.min_amount !== undefined && item.min_amount !== null
          ? Number(item.min_amount)
          : null;
      const existing = await models.PushPreference.findOne({
        where: { user_id: userId, event_key: item.event_key },
        ...opts,
      });
      if (existing) {
        await existing.update(
          {
            enabled: Boolean(item.enabled),
            min_amount: nextMin,
            ...(hasQuietUpdate ? { quiet_from: nextQuietFrom, quiet_to: nextQuietTo } : {}),
          },
          opts,
        );
      } else {
        await models.PushPreference.create(
          {
            user_id: userId,
            event_key: item.event_key,
            enabled: Boolean(item.enabled),
            min_amount: nextMin,
            ...(hasQuietUpdate ? { quiet_from: nextQuietFrom, quiet_to: nextQuietTo } : {}),
          },
          opts,
        );
      }
    }

    if (hasQuietUpdate) {
      if (models.PushPreference?.update) {
        await models.PushPreference.update(
          { quiet_from: nextQuietFrom, quiet_to: nextQuietTo },
          { where: { user_id: userId }, ...opts },
        );
      } else if (models.PushPreference?.findAll) {
        const existingRows = await models.PushPreference.findAll({
          where: { user_id: userId },
          ...opts,
        });
        for (const r of existingRows || []) {
          if (typeof r.update === "function") {
            await r.update({ quiet_from: nextQuietFrom, quiet_to: nextQuietTo }, opts);
          } else {
            r.quiet_from = nextQuietFrom;
            r.quiet_to = nextQuietTo;
          }
        }
      }
      const existingAny = models.PushPreference?.findOne
        ? await models.PushPreference.findOne({ where: { user_id: userId }, ...opts })
        : null;
      if (!existingAny && items.length === 0 && models.PushPreference?.create) {
        await models.PushPreference.create(
          {
            user_id: userId,
            event_key: PUSH_EVENTS[0].key,
            enabled: true,
            min_amount: null,
            quiet_from: nextQuietFrom,
            quiet_to: nextQuietTo,
          },
          opts,
        );
      }
    }

    if (device && payload.muted !== undefined && typeof device.update === "function") {
      await device.update({ muted: Boolean(payload.muted) }, opts);
    }
  };

  if (typeof models?.sequelize?.transaction === "function") {
    await models.sequelize.transaction(persist);
  } else {
    await persist(null);
  }

  return getUserPushPreferences(models, userId, device);
};

const listUserIdsByRoles = async (models, roleIds) => {
  if (!Array.isArray(roleIds) || roleIds.length === 0 || !models?.User?.findAll || !models?.Role) {
    return [];
  }
  const users = await models.User.findAll({
    where: { is_active: true },
    attributes: ["user_id", "is_active"],
    include: [
      {
        model: models.Role,
        required: true,
        where: { role_id: { [Op.in]: roleIds }, is_active: true },
        attributes: ["role_id", "is_active"],
        through: { attributes: [] },
      },
    ],
  });
  return (users || [])
    .filter((u) => {
      if (u.is_active === false) return false;
      if (!Array.isArray(u.Roles)) return true;
      return u.Roles.some((r) => roleIds.includes(Number(r.role_id)) && r.is_active !== false);
    })
    .map((u) => Number(u.user_id));
};

const enqueueDigestEntries = ({
  tenantKey,
  models,
  recipientIds,
  eventKey,
  amount,
  includeAmounts,
  silentByUserId,
  digestMinutes,
  now,
}) => {
  const flushAfterMs = now.getTime() + Number(digestMinutes || 30) * 60 * 1000;
  for (const uid of recipientIds) {
    const key = `${tenantKey}:${uid}`;
    let bucket = digestBuckets.get(key);
    if (!bucket) {
      bucket = {
        tenantKey,
        models,
        userId: uid,
        dueAtMs: flushAfterMs,
        silent: false,
        includeAmounts,
        counts: new Map(),
        totals: new Map(),
      };
      digestBuckets.set(key, bucket);
    }
    if (silentByUserId.get(uid)) bucket.silent = true;
    bucket.includeAmounts = bucket.includeAmounts && includeAmounts;
    bucket.counts.set(eventKey, (bucket.counts.get(eventKey) || 0) + 1);
    if (amount !== null && Number.isFinite(Number(amount))) {
      bucket.totals.set(eventKey, (bucket.totals.get(eventKey) || 0) + Number(amount));
    }
  }
};

const formatDigestSummary = (bucket) => {
  const labelMap = {
    invoice_created: ["new bill", "new bills"],
    payment_received: ["payment received", "payments received"],
    return_processed: ["return", "returns"],
    invoice_deleted: ["bill deleted", "bills deleted"],
    invoice_restored: ["bill restored", "bills restored"],
    payment_voided: ["payment voided", "payments voided"],
    contact_used: ["contact used", "contacts used"],
    customer_blacklisted: ["blacklisted", "blacklisted"],
  };
  const parts = [];
  for (const [evKey, cnt] of bucket.counts.entries()) {
    const [singular, plural] = labelMap[evKey] || [evKey, evKey];
    const base = `${cnt} ${cnt === 1 ? singular : plural}`;
    const total = bucket.totals.get(evKey);
    if (bucket.includeAmounts && total && total > 0) {
      parts.push(`${base} (LKR ${Math.round(total).toLocaleString("en-US")})`);
    } else {
      parts.push(base);
    }
  }
  return parts.join(" · ");
};

export const flushPushDigests = async ({ now = new Date(), force = false } = {}) => {
  const nowMs = now.getTime();
  let flushed = 0;
  for (const [key, bucket] of [...digestBuckets.entries()]) {
    if (!force && bucket.dueAtMs > nowMs) continue;
    digestBuckets.delete(key);
    const body = formatDigestSummary(bucket);
    if (!body) continue;
    const title = "GearGrid activity summary";
    await devicePushService.sendToUsers(bucket.models, [bucket.userId], {
      title,
      body,
      data: { type: "digest_summary" },
      silent: bucket.silent,
      channel: bucket.silent ? "bills_silent" : "digest",
    });
    flushed += 1;
  }
  return { flushed };
};

export const sendDailySummaryPush = async (models, { now = new Date(), tenantDbName = null } = {}) => {
  const config = models?.TenantConfig?.findOne ? await models.TenantConfig.findOne() : null;
  const settings = readStoredPushSettings(config);
  const ds = settings.daily_summary;
  if (!ds?.enabled) {
    return { sent: 0, skipped: "disabled" };
  }

  const dbName = tenantDbName ?? models?.sequelize?.config?.database;
  if (dbName) {
    const plan = await getTenantPlan(dbName);
    if (plan && plan.features?.phone_assistant === false) {
      return { sent: 0, skipped: "plan" };
    }
  }

  const [adminIds, roleIds] = await Promise.all([
    listAdminUserIds(models),
    listUserIdsByRoles(models, ds.recipient_role_ids),
  ]);
  const recipients = [
    ...new Set([...(adminIds || []), ...(roleIds || [])].map(Number).filter((n) => n > 0)),
  ];
  if (recipients.length === 0) {
    return { sent: 0, skipped: "no_recipients" };
  }

  const tz = config?.timezone || DEFAULT_TIMEZONE;
  const todayYmd = dayInShopTz(now, tz);
  const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowYmd = dayInShopTz(tomorrowDate, tz);

  const invoices = models?.Invoice?.findAll
    ? await models.Invoice.findAll({
        where: { is_deleted: false },
        include: [
          ...(models.Payment
            ? [{ model: models.Payment, required: false, attributes: ["payment_amount", "payment_date", "is_voided"] }]
            : []),
          ...(models.InvoiceLine
            ? [{ model: models.InvoiceLine, required: false }]
            : []),
        ],
      })
    : [];

  let billsTodayCount = 0;
  let billsTodayTotal = 0;
  let paymentsTodayCount = 0;
  let paymentsTodayTotal = 0;
  let returnsTodayCount = 0;
  let dueTomorrowCount = 0;
  let overdueCount = 0;

  for (const inv of invoices || []) {
    const issuedYmd = inv.issued_date ? dayInShopTz(new Date(inv.issued_date), tz) : null;
    if (issuedYmd === todayYmd) {
      billsTodayCount += 1;
      billsTodayTotal += Number(liveTotalOf(inv) || 0);
    }
    for (const p of inv.Payments || []) {
      if (p.is_voided) continue;
      const pYmd = p.payment_date ? dayInShopTz(new Date(p.payment_date), tz) : null;
      if (pYmd === todayYmd) {
        paymentsTodayCount += 1;
        paymentsTodayTotal += Number(p.payment_amount || 0);
      }
    }
    if (inv.status === "Completed" && inv.updatedAt) {
      const updYmd = dayInShopTz(new Date(inv.updatedAt), tz);
      if (updYmd === todayYmd) returnsTodayCount += 1;
    }
    if (["Active", "PendingPayment"].includes(inv.status)) {
      const hasOverdueLine = (inv.InvoiceLines || []).some(
        (l) =>
          l.line_status !== "Completed" &&
          l.expected_return_date &&
          String(l.expected_return_date).slice(0, 10) < todayYmd,
      );
      if (hasOverdueLine) overdueCount += 1;

      const hasTomorrowLine = (inv.InvoiceLines || []).some(
        (l) =>
          l.line_status !== "Completed" &&
          l.expected_return_date &&
          String(l.expected_return_date).slice(0, 10) === tomorrowYmd,
      );
      if (hasTomorrowLine) dueTomorrowCount += 1;
    }
  }

  const parts = [];
  if (ds.sections?.bills) {
    parts.push(
      settings.include_amounts
        ? `${billsTodayCount} bills (LKR ${Math.round(billsTodayTotal).toLocaleString("en-US")})`
        : `${billsTodayCount} bills`,
    );
  }
  if (ds.sections?.payments) {
    parts.push(
      settings.include_amounts
        ? `${paymentsTodayCount} payments (LKR ${Math.round(paymentsTodayTotal).toLocaleString("en-US")})`
        : `${paymentsTodayCount} payments`,
    );
  }
  if (ds.sections?.returns) parts.push(`${returnsTodayCount} returns`);
  if (ds.sections?.due_tomorrow) parts.push(`${dueTomorrowCount} due tomorrow`);
  if (ds.sections?.overdue) parts.push(`${overdueCount} overdue`);

  const title = `Daily summary · ${todayYmd}`;
  const body = parts.join(" · ") || "No activity today.";
  const silent = isWithinQuietHours(settings.quiet_hours, now, tz);

  const res = await devicePushService.sendToUsers(models, recipients, {
    title,
    body,
    data: { type: "daily_summary", date: todayYmd },
    silent,
    channel: silent ? "bills_silent" : "digest",
  });

  return {
    sent: Number(res?.sent ?? 0),
    reached: Number(res?.reached ?? 0),
    title,
    body,
    recipients,
  };
};

/**
 * Evaluate shop settings + personal narrowing preferences + quiet hours,
 * persist in-app notifications, and dispatch mobile push alerts. Never throws.
 */
export const notifyEvent = async (
  models,
  eventKey,
  {
    amount = null,
    actorUserId = null,
    customerName = null,
    vars = null,
    title = "",
    body = "",
    titleNoAmount = null,
    bodyNoAmount = null,
    titleNoCustomerName = null,
    bodyNoCustomerName = null,
    data = {},
    link = null,
    category = "phone_assistant",
    type = "info",
    now = new Date(),
    tenantDbName = null,
  } = {},
) => {
  try {
    const eventMeta = PUSH_EVENTS_BY_KEY[eventKey];
    if (!eventMeta) {
      return { sent: 0, reached: 0, recipients: [], skipped: "unknown_event" };
    }

    const dbName = tenantDbName ?? models?.sequelize?.config?.database;
    if (dbName) {
      const plan = await getTenantPlan(dbName);
      if (plan && plan.features?.phone_assistant === false) {
        return { sent: 0, reached: 0, recipients: [], skipped: "plan" };
      }
    }

    const [config, policyResult] = await Promise.all([
      models?.TenantConfig?.findOne ? models.TenantConfig.findOne() : null,
      getPhoneAssistantPolicy(models),
    ]);
    const policy = policyResult.policy;
    const settings = readStoredPushSettings(config);
    const rule = settings.events[eventKey];

    // 1. Shop event enabled check
    if (!rule?.enabled) {
      return { sent: 0, reached: 0, recipients: [], skipped: "disabled" };
    }

    // 2. Shop min_amount check
    const numericAmount = amount === null || amount === undefined ? null : Number(amount);
    const shopMin = eventMeta.has_amount ? Number(rule.min_amount || 0) : 0;
    if (
      eventMeta.has_amount &&
      shopMin > 0 &&
      (numericAmount === null || !Number.isFinite(numericAmount) || numericAmount < shopMin)
    ) {
      return { sent: 0, reached: 0, recipients: [], skipped: "shop_min_amount" };
    }

    // 3. Recipients from admins + configured recipient_role_ids
    const [adminIds, roleIds] = await Promise.all([
      listAdminUserIds(models),
      listUserIdsByRoles(models, rule.recipient_role_ids),
    ]);

    let candidateIds = [
      ...new Set(
        [...(adminIds || []), ...(roleIds || [])]
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ];

    // 4. Drop actor unless notify_actor is enabled
    if (!settings.notify_actor && actorUserId !== null && actorUserId !== undefined) {
      const actorNum = Number(actorUserId);
      candidateIds = candidateIds.filter((id) => id !== actorNum);
    }

    if (candidateIds.length === 0) {
      return { sent: 0, reached: 0, recipients: [], skipped: "no_recipients" };
    }

    // 5. Personal overrides & personal quiet hours
    let finalRecipients = candidateIds;
    const quietByUserId = new Map();
    if (models?.PushPreference?.findAll) {
      const userPrefs = await models.PushPreference.findAll({
        where: {
          user_id: { [Op.in]: candidateIds },
        },
      });
      const prefByUserId = new Map();
      for (const p of userPrefs || []) {
        const uid = Number(p.user_id);
        if (p.quiet_from && p.quiet_to && !quietByUserId.has(uid)) {
          quietByUserId.set(uid, {
            enabled: true,
            from: String(p.quiet_from),
            to: String(p.quiet_to),
          });
        }
        if (p.event_key === eventKey) {
          prefByUserId.set(uid, p);
        }
      }

      finalRecipients = candidateIds.filter((uid) => {
        const pref = prefByUserId.get(uid);
        if (!pref) return true;
        if (pref.enabled === false) return false;
        if (eventMeta.has_amount && pref.min_amount !== null && pref.min_amount !== undefined) {
          const userMin = Number(pref.min_amount);
          const effectiveMin = Math.max(shopMin, Number.isFinite(userMin) ? userMin : 0);
          if (numericAmount === null || !Number.isFinite(numericAmount) || numericAmount < effectiveMin) {
            return false;
          }
        }
        return true;
      });
    }

    if (finalRecipients.length === 0) {
      return { sent: 0, reached: 0, recipients: [], skipped: "user_preferences" };
    }

    // 6. New callers provide structured vars. Older callers retain their rendered copy for one release.
    let pushTitle = title;
    let pushBody = body;
    if (vars && typeof vars === "object") {
      const rendered = await renderForRecipient(models, eventKey, vars, {
        language: policy.notifications?.default_language || "en",
        hideAmounts: settings.include_amounts === false,
        hideCustomer: rule.hide_customer_name === true,
        policy,
      });
      pushTitle = rendered.title;
      pushBody = rendered.body;
    } else {
      if (settings.include_amounts === false) {
        pushTitle = titleNoAmount != null ? titleNoAmount : stripCurrencyAmounts(pushTitle);
        pushBody = bodyNoAmount != null ? bodyNoAmount : stripCurrencyAmounts(pushBody);
      }
      if (rule.hide_customer_name === true) {
        pushTitle = titleNoCustomerName != null ? titleNoCustomerName : redactCustomerName(pushTitle, customerName);
        pushBody = bodyNoCustomerName != null ? bodyNoCustomerName : redactCustomerName(pushBody, customerName);
      }
    }

    // 7. Quiet hours check per recipient (shop OR personal)
    const tenantTz = config?.timezone || DEFAULT_TIMEZONE;
    const shopSilent = isWithinQuietHours(settings.quiet_hours, now, tenantTz);
    const silentByUserId = new Map();
    const loudRecipients = [];
    const silentRecipients = [];
    for (const uid of finalRecipients) {
      const userQuiet = quietByUserId.get(uid);
      const isUserSilent = shopSilent || isWithinQuietHours(userQuiet, now, tenantTz);
      silentByUserId.set(uid, isUserSilent);
      if (isUserSilent) silentRecipients.push(uid);
      else loudRecipients.push(uid);
    }

    // 8. Persist in-app notifications for all recipients
    for (const recipientId of finalRecipients) {
      try {
        await createNotification(models, {
          userId: recipientId,
          type,
          category,
          title: title || pushTitle,
          message: body || pushBody,
          payload: data,
          link,
        });
      } catch {
        // Never allow in-app notification failure to block push or other recipients
      }
    }

    // 9. Digest batching vs instant push dispatch
    if (rule.delivery === "digest") {
      enqueueDigestEntries({
        tenantKey: String(dbName || "default"),
        models,
        recipientIds: finalRecipients,
        eventKey,
        amount: numericAmount,
        includeAmounts: settings.include_amounts !== false,
        silentByUserId,
        digestMinutes: settings.digest_minutes || 30,
        now,
      });
      return {
        sent: 0,
        reached: 0,
        queued_digest: true,
        silent: silentRecipients.length === finalRecipients.length,
        recipients: finalRecipients,
      };
    }

    let totalSent = 0;
    let totalReached = 0;
    const groupChannel = eventMeta.group || "bills";

    if (loudRecipients.length > 0) {
      const pushRes = await devicePushService.sendToUsers(models, loudRecipients, {
        title: pushTitle,
        body: pushBody,
        data,
        silent: false,
        channel: groupChannel,
      });
      totalSent += Number(pushRes?.sent ?? 0);
      totalReached += Number(pushRes?.reached ?? 0);
    }

    if (silentRecipients.length > 0) {
      const pushRes = await devicePushService.sendToUsers(models, silentRecipients, {
        title: pushTitle,
        body: pushBody,
        data,
        silent: true,
        channel: "bills_silent",
      });
      totalSent += Number(pushRes?.sent ?? 0);
      totalReached += Number(pushRes?.reached ?? 0);
    }

    return {
      sent: totalSent,
      reached: totalReached,
      silent: silentRecipients.length > 0 && loudRecipients.length === 0,
      recipients: finalRecipients,
    };
  } catch {
    return { sent: 0, reached: 0, recipients: [] };
  }
};
