import { Op } from "sequelize";
import AppError from "../utils/AppError.js";
import { parseJsonField } from "../utils/jsonFields.js";
import { PUSH_EVENTS, PUSH_EVENTS_BY_KEY } from "../config/pushEvents.js";
import { createNotification } from "./notificationService.js";
import * as devicePushService from "./devicePushService.js";
import { isUserAdmin, listAdminUserIds } from "./userService.js";
import { getTenantPlan } from "./planService.js";

const DEFAULT_TIMEZONE = "Asia/Colombo";
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const buildDefaultPushSettings = () => {
  const events = {};
  for (const ev of PUSH_EVENTS) {
    events[ev.key] = {
      enabled: Boolean(ev.default_enabled),
      min_amount: 0,
      recipient_role_ids: [],
    };
  }
  return {
    events,
    quiet_hours: { enabled: false, from: "21:00", to: "07:00" },
    include_amounts: true,
    notify_actor: false,
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
    };
  }

  const rawQuiet = parsed.quiet_hours && typeof parsed.quiet_hours === "object" ? parsed.quiet_hours : {};
  const fromStr = TIME_RE.test(String(rawQuiet.from || "")) ? String(rawQuiet.from) : defaults.quiet_hours.from;
  const toStr = TIME_RE.test(String(rawQuiet.to || "")) ? String(rawQuiet.to) : defaults.quiet_hours.to;

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
      // An event removed from the catalog (contact_used) may still come from a page opened before the
      // update. mergePushSettings keeps catalog events only, so it is skipped rather than refused.
      if (!PUSH_EVENTS_BY_KEY[key]) continue;
      const rule = payload.events[key];
      if (rule && rule.min_amount !== undefined && rule.min_amount !== null) {
        const num = Number(rule.min_amount);
        if (!Number.isFinite(num) || num < 0) {
          throw new AppError(`Invalid minimum amount for ${key}.`, 400);
        }
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

  const config = await models.TenantConfig.findOne();
  if (!config) {
    throw new AppError("Tenant config missing.", 500);
  }

  const custom = parseJsonField(config.custom_settings, {});
  const pa = parseJsonField(custom.phone_assistant, {});
  const nextSettings = mergePushSettings({
    ...readStoredPushSettings(config),
    ...payload,
    events: {
      ...readStoredPushSettings(config).events,
      ...(payload.events || {}),
    },
    quiet_hours: {
      ...readStoredPushSettings(config).quiet_hours,
      ...(payload.quiet_hours || {}),
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

export const getUserPushPreferences = async (models, userId) => {
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

  return { preferences };
};

export const updateUserPushPreferences = async (models, userId, payload = {}) => {
  // Events no longer in the catalog (contact_used) may come from a page opened before the update.
  const items = (Array.isArray(payload.preferences) ? payload.preferences : []).filter(
    (item) => PUSH_EVENTS_BY_KEY[item?.event_key],
  );

  for (const item of items) {
    if (item.min_amount !== undefined && item.min_amount !== null) {
      const num = Number(item.min_amount);
      if (!Number.isFinite(num) || num < 0) {
        throw new AppError(`Invalid minimum amount for ${item.event_key}.`, 400);
      }
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
          { enabled: Boolean(item.enabled), min_amount: nextMin },
          opts,
        );
      } else {
        await models.PushPreference.create(
          {
            user_id: userId,
            event_key: item.event_key,
            enabled: Boolean(item.enabled),
            min_amount: nextMin,
          },
          opts,
        );
      }
    }
  };

  if (typeof models?.sequelize?.transaction === "function") {
    await models.sequelize.transaction(persist);
  } else {
    await persist(null);
  }

  return getUserPushPreferences(models, userId);
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
    title = "",
    body = "",
    titleNoAmount = null,
    bodyNoAmount = null,
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

    const config = models?.TenantConfig?.findOne ? await models.TenantConfig.findOne() : null;
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

    // 5. Personal overrides can only narrow (never widen above shop rule)
    let finalRecipients = candidateIds;
    if (models?.PushPreference?.findAll) {
      const userPrefs = await models.PushPreference.findAll({
        where: {
          user_id: { [Op.in]: candidateIds },
          event_key: eventKey,
        },
      });
      const prefByUserId = new Map((userPrefs || []).map((p) => [Number(p.user_id), p]));

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

    // 6. Strip LKR figures from lock-screen push text when include_amounts === false
    let pushTitle = title;
    let pushBody = body;
    if (settings.include_amounts === false) {
      pushTitle = titleNoAmount != null ? titleNoAmount : stripCurrencyAmounts(title);
      pushBody = bodyNoAmount != null ? bodyNoAmount : stripCurrencyAmounts(body);
    }

    // 7. Downgrade to silent (normal priority, no sound) during quiet hours
    const tenantTz = config?.timezone || DEFAULT_TIMEZONE;
    const silent = isWithinQuietHours(settings.quiet_hours, now, tenantTz);

    // 8. Persist in-app notifications + send push
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

    const pushRes = await devicePushService.sendToUsers(models, finalRecipients, {
      title: pushTitle,
      body: pushBody,
      data,
      silent,
    });

    return {
      sent: Number(pushRes?.sent ?? 0),
      reached: Number(pushRes?.reached ?? 0),
      silent,
      recipients: finalRecipients,
    };
  } catch {
    return { sent: 0, reached: 0, recipients: [] };
  }
};
