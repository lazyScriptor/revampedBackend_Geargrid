import { Op } from "sequelize";
import ExcelJS from "exceljs";
import AppError from "../utils/AppError.js";
import { parseJsonField } from "../utils/jsonFields.js";
import { ACTIVITY_EVENT_TYPES } from "../models/ActivityEvent.js";
import { getActivitySettings } from "./activitySettingsService.js";
import { notifyEvent } from "./pushEventService.js";
import { createNotification } from "./notificationService.js";

const DEFAULT_TIMEZONE = "Asia/Colombo";
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const formatLkr = (n) => {
  const num = Number(n || 0);
  return Number.isInteger(num)
    ? num.toLocaleString("en-US")
    : num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const parseMinutes = (hhmm) => {
  const m = TIME_RE.exec(String(hhmm || ""));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

export const isWithinBusinessHours = (businessHours, date = new Date(), timezone = DEFAULT_TIMEZONE) => {
  const fromMin = parseMinutes(businessHours?.from || "08:00");
  const toMin = parseMinutes(businessHours?.to || "18:00");
  if (fromMin === null || toMin === null || fromMin === toMin) return true;

  const tz = timezone || DEFAULT_TIMEZONE;
  let hh = 0;
  let mm = 0;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    hh = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
    mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  } catch {
    hh = date.getUTCHours();
    mm = date.getUTCMinutes();
  }

  const currentMin = hh * 60 + mm;
  if (fromMin < toMin) {
    return currentMin >= fromMin && currentMin < toMin;
  }
  return currentMin >= fromMin || currentMin < toMin;
};

const getTzOffsetString = (timezone = DEFAULT_TIMEZONE, refDate = new Date()) => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || DEFAULT_TIMEZONE,
      timeZoneName: "shortOffset",
    }).formatToParts(refDate);
    const tzName = parts.find((p) => p.type === "timeZoneName")?.value || "GMT+05:30";
    const m = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!m) return "+05:30";
    const sign = m[1];
    const hh = String(m[2]).padStart(2, "0");
    const mm = String(m[3] || "00").padStart(2, "0");
    return `${sign}${hh}:${mm}`;
  } catch {
    return "+05:30";
  }
};

const dayStringInTz = (date = new Date(), timezone = DEFAULT_TIMEZONE) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const formatCustomerDisplay = (c) => {
  if (!c) return "Customer";
  if (c.customer_type === "Business" && c.company_name) return c.company_name;
  return `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Customer";
};

const formatStaffDisplay = (u) => {
  if (!u) return "Staff";
  return `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username || "Staff";
};

const ACTIVITY_TO_PUSH_KEY = {
  invoice_created: "invoice_created",
  payment: "payment_received",
  return: "return_processed",
  invoice_deleted: "invoice_deleted",
  invoice_restored: "invoice_restored",
  payment_voided: "payment_voided",
  discount: "discount",
  refund: "refund",
  backdated_payment: "backdated_payment",
  backdated_bill: "backdated_bill",
  backdated_return: "backdated_return",
  invoice_reopened: "invoice_reopened",
  id_card_released_unpaid: "id_card_released_unpaid",
  review: "review",
  customer_payment: "customer_payment",
  call_promise_missed: "call_promise_missed",
  system: null,
};

export const computeEventRisk = (type, { amount = null, data = {}, after_hours = false, risk = null }, thresholds = {}) => {
  if (risk === "high") return "high";
  if (after_hours) return "high";

  const amt = Number(amount || 0);
  const discountHighPct = Number(thresholds.discountHighPct ?? 10);
  const discountHighAmount = Number(thresholds.discountHighAmount ?? 5000);
  const backdateHighDays = Number(thresholds.backdateHighDays ?? 2);
  const refundHighAmount = Number(thresholds.refundHighAmount ?? 5000);

  switch (type) {
    case "discount": {
      const pct = Number(data?.discount_pct ?? data?.pct ?? 0);
      if (pct > discountHighPct || amt > discountHighAmount || data?.raised_after_printing === true) {
        return "high";
      }
      return "normal";
    }
    case "backdated_payment":
    case "backdated_bill":
      return Number(data?.days_back || 0) > backdateHighDays ? "high" : "normal";
    case "backdated_return":
    case "payment_voided":
    case "invoice_deleted":
    case "id_card_released_unpaid":
      return "high";
    case "refund":
      return amt > refundHighAmount ? "high" : "normal";
    case "return":
      return Boolean(data?.has_damaged) || Number(data?.damaged_qty || 0) > 0 ? "high" : "normal";
    case "review":
      return Boolean(data?.has_negative) || (Array.isArray(data?.negative_tags) && data.negative_tags.length > 0)
        ? "high"
        : "normal";
    default:
      return "normal";
  }
};

export const buildEventSentence = (type, { invoice_id, amount, data = {}, customerName = "", staffName = "" }) => {
  const inv = invoice_id ? `INV-${invoice_id}` : "";
  const amtStr = amount !== null && amount !== undefined ? `Rs ${formatLkr(amount)}` : "";
  const cust = customerName || data?.customer_name || "";
  const staff = staffName || data?.staff_name || "";
  const reason = data?.reason_label_en || data?.reason || "";
  const reasonSi = data?.reason_label_si || reason;

  const joinParts = (parts) => parts.filter(Boolean).join(" · ");

  switch (type) {
    case "invoice_created":
      return {
        en: joinParts([`New bill ${amtStr}`.trim(), cust, staff]),
        si: joinParts([`නව බිල්පත ${amtStr}`.trim(), cust, staff]),
      };
    case "backdated_bill": {
      const days = Number(data?.days_back || 0);
      return {
        en: joinParts([`Bill dated ${days} day(s) back`, amtStr, inv, cust, staff]),
        si: joinParts([`දින ${days}කට පෙර බිල්පත`, amtStr, inv, cust, staff]),
      };
    }
    case "payment":
      return {
        en: joinParts([`Payment ${amtStr}`.trim(), inv, data?.method, staff]),
        si: joinParts([`ගෙවීම ${amtStr}`.trim(), inv, data?.method, staff]),
      };
    case "backdated_payment": {
      const days = Number(data?.days_back || 0);
      return {
        en: joinParts([`Payment dated ${days} day(s) back`, amtStr, inv, reason, staff]),
        si: joinParts([`දින ${days}කට පෙර ගෙවීම`, amtStr, inv, reasonSi, staff]),
      };
    }
    case "refund":
      return {
        en: joinParts([`Refund ${amtStr}`.trim(), inv, data?.method, reason, staff]),
        si: joinParts([`ආපසු ගෙවීම ${amtStr}`.trim(), inv, data?.method, reasonSi, staff]),
      };
    case "discount": {
      const pct = Number(data?.discount_pct || 0);
      const pctStr = pct > 0 ? ` (${Math.round(pct)}%)` : "";
      const afterPrint = data?.raised_after_printing ? "raised after printing" : "";
      return {
        en: joinParts([`Discount ${amtStr}${pctStr}`.trim(), afterPrint, reason, inv, staff]),
        si: joinParts([`වට්ටම ${amtStr}${pctStr}`.trim(), data?.raised_after_printing ? "මුද්‍රණයෙන් පසු වැඩි කළා" : "", reasonSi, inv, staff]),
      };
    }
    case "return": {
      const qty = Number(data?.returned_qty || 0);
      const late = Number(data?.late_days || 0);
      const dmg = Number(data?.damaged_qty || 0);
      const qtyText = qty > 0 ? `Returned ${qty} machine(s)` : "Return processed";
      const lateText = late > 0 ? `${late} day(s) late` : "";
      const dmgText = dmg > 0 ? `${dmg} damaged` : "";
      return {
        en: joinParts([qtyText, inv, lateText, dmgText, staff]),
        si: joinParts([qty > 0 ? `උපකරණ ${qty}ක් ආපසු ලැබුණි` : "ආපසු භාරගැනීම", inv, late > 0 ? `දින ${late}ක් ප්‍රමාදයි` : "", dmg > 0 ? `හානි ${dmg}` : "", staff]),
      };
    }
    case "backdated_return": {
      const days = Number(data?.days_back || 0);
      const diff = Number(data?.late_fee_difference || 0);
      const diffText =
        diff > 0
          ? `late fee Rs ${formatLkr(diff)} less`
          : diff < 0
            ? `late fee Rs ${formatLkr(Math.abs(diff))} more`
            : "";
      return {
        en: joinParts([`Return dated ${days} day(s) back`, diffText, inv, reason, staff]),
        si: joinParts([`දින ${days}කට පෙර ආපසු භාරගැනීම`, diff > 0 ? `ප්‍රමාද ගාස්තුව Rs ${formatLkr(diff)} අඩුයි` : "", inv, reasonSi, staff]),
      };
    }
    case "payment_voided":
      return {
        en: joinParts([`Payment voided ${amtStr}`.trim(), inv, reason, staff]),
        si: joinParts([`ගෙවීම අවලංගු කළා ${amtStr}`.trim(), inv, reasonSi, staff]),
      };
    case "invoice_deleted":
      return {
        en: joinParts([`Bill deleted ${inv}`.trim(), amtStr, reason, staff]),
        si: joinParts([`බිල්පත මකා දැමුවා ${inv}`.trim(), amtStr, reasonSi, staff]),
      };
    case "invoice_restored":
      return {
        en: joinParts([`Bill restored ${inv}`.trim(), amtStr, staff]),
        si: joinParts([`බිල්පත ප්‍රතිසාධනය කළා ${inv}`.trim(), amtStr, staff]),
      };
    case "invoice_reopened":
      return {
        en: joinParts([`Bill reopened ${inv}`.trim(), cust, staff]),
        si: joinParts([`බිල්පත නැවත විවෘත කළා ${inv}`.trim(), cust, staff]),
      };
    case "id_card_released_unpaid":
      return {
        en: joinParts([`ID card released with ${amtStr || "Rs 0"} unpaid`, inv, cust, staff]),
        si: joinParts([`${amtStr || "Rs 0"} හිඟ තිබියදී හැඳුනුම්පත නිදහස් කළා`, inv, cust, staff]),
      };
    case "review": {
      const labels = Array.isArray(data?.tag_labels_en) ? data.tag_labels_en.join(" · ") : "";
      const labelsSi = Array.isArray(data?.tag_labels_si) ? data.tag_labels_si.join(" · ") : labels;
      return {
        en: joinParts([labels ? `Review: ${labels}` : "Customer review", cust, inv, staff]),
        si: joinParts([labelsSi ? `සමාලෝචනය: ${labelsSi}` : "පාරිභෝගික සමාලෝචනය", cust, inv, staff]),
      };
    }
    case "customer_payment":
      return {
        en: joinParts([`Customer payment ${amtStr}`.trim(), cust, staff]),
        si: joinParts([`පාරිභෝගික ගෙවීම ${amtStr}`.trim(), cust, staff]),
      };
    case "call_promise_missed":
      return {
        en: joinParts([`Promise missed ${amtStr}`.trim(), cust, inv]),
        si: joinParts([`ගෙවීමේ පොරොන්දුව කඩ විය ${amtStr}`.trim(), cust, inv]),
      };
    default:
      return {
        en: joinParts([data?.title || "System event", inv, cust, staff]),
        si: joinParts([data?.title_si || data?.title || "පද්ධති සිදුවීම", inv, cust, staff]),
      };
  }
};

/**
 * Record an activity event in ACTIVITY_EVENTS inside the caller's transaction,
 * then dispatch the push notification via notifyEvent after the transaction commits.
 *
 * Signature is FIXED for Slices 1, 2 and 3.
 */
export const recordActivity = async (
  models,
  {
    type,
    invoice_id = null,
    customer_id = null,
    actor_user_id = null,
    amount = null,
    data = {},
    occurred_at = null,
    risk = null,
  },
  { transaction } = {},
) => {
  if (!ACTIVITY_EVENT_TYPES.includes(type)) {
    throw new AppError(`Invalid activity event type: ${type}`, 400);
  }

  const occurredAt = occurred_at ? new Date(occurred_at) : new Date();
  const settings = await getActivitySettings(models, { transaction });
  const after_hours = !isWithinBusinessHours(settings.business_hours, occurredAt, settings.timezone);
  const finalRisk = computeEventRisk(
    type,
    { amount, data, after_hours, risk },
    settings.activity,
  );

  // Best-effort name resolution for one-line sentence
  let customerName = data?.customer_name || "";
  let staffName = data?.staff_name || "";
  try {
    const [cust, actor] = await Promise.all([
      !customerName && customer_id && models?.Customer?.findByPk
        ? models.Customer.findByPk(customer_id, {
            attributes: ["customer_id", "first_name", "last_name", "company_name", "customer_type"],
            transaction,
          })
        : null,
      !staffName && actor_user_id && models?.User?.findByPk
        ? models.User.findByPk(actor_user_id, {
            attributes: ["user_id", "first_name", "last_name", "username"],
            transaction,
          })
        : null,
    ]);
    if (cust) customerName = formatCustomerDisplay(cust);
    if (actor) staffName = formatStaffDisplay(actor);
  } catch {
    // Non-fatal
  }

  const sentence =
    data?.sentence && typeof data.sentence === "object" && data.sentence.en
      ? data.sentence
      : buildEventSentence(type, { invoice_id, amount, data, customerName, staffName });

  const enrichedData = {
    ...(data && typeof data === "object" ? data : {}),
    ...(customerName ? { customer_name: customerName } : {}),
    ...(staffName ? { staff_name: staffName } : {}),
    sentence,
  };

  const eventRow = await models.ActivityEvent.create(
    {
      type,
      risk: finalRisk,
      invoice_id: invoice_id ?? null,
      customer_id: customer_id ?? null,
      actor_user_id: actor_user_id ?? null,
      amount: amount !== null && amount !== undefined ? Number(amount) : null,
      data: enrichedData,
      occurred_at: occurredAt,
      after_hours,
    },
    { transaction },
  );

  const pushEventKey = ACTIVITY_TO_PUSH_KEY[type];
  const dispatchPush = async () => {
    if (!pushEventKey) return;
    try {
      await notifyEvent(models, pushEventKey, {
        amount: amount !== null && amount !== undefined ? Number(amount) : null,
        actorUserId: actor_user_id,
        customerName: customerName || null,
        isHigh: finalRisk === "high",
        activityType: type,
        title: `${after_hours ? "🌙 " : ""}${sentence.en}`,
        body: invoice_id ? `Bill #${invoice_id}` : customerName || "Activity alert",
        titleNoAmount: `${after_hours ? "🌙 " : ""}${type.replace(/_/g, " ")}${invoice_id ? ` #${invoice_id}` : ""}`,
        bodyNoAmount: [customerName, staffName].filter(Boolean).join(" · "),
        data: {
          type,
          event_id: String(eventRow.event_id),
          ...(invoice_id ? { invoice_id: String(invoice_id) } : {}),
          risk: finalRisk,
        },
        link: invoice_id ? `/invoices?mode=manage&invoiceId=${invoice_id}` : "/activity",
      });
    } catch {
      // Push failures must never break the action
    }
  };

  if (transaction && typeof transaction.afterCommit === "function") {
    transaction.afterCommit(() => {
      void dispatchPush();
    });
  } else {
    void dispatchPush();
  }

  return eventRow;
};

// ── Role visibility helper ────────────────────────────────────────────────────

export const resolveUserActivityVisibility = async (models, userId, roleIds = null) => {
  const settings = await getActivitySettings(models);
  const roleMap = settings.activity_roles || {};
  const configuredKeys = Object.keys(roleMap);
  if (configuredKeys.length === 0) {
    return { allowedTypes: null, seeAmounts: true, settings };
  }

  let effectiveRoleIds = Array.isArray(roleIds) ? roleIds.map(String) : null;
  if (!effectiveRoleIds && userId && models?.User?.findByPk) {
    const user = await models.User.findByPk(userId, {
      attributes: ["user_id"],
      include: models.Role
        ? [{ model: models.Role, attributes: ["role_id", "is_active"], through: { attributes: [] } }]
        : [],
    });
    effectiveRoleIds = (user?.Roles || [])
      .filter((r) => r.is_active !== false)
      .map((r) => String(r.role_id));
  }

  const matched = (effectiveRoleIds || [])
    .map((rid) => roleMap[rid])
    .filter(Boolean);

  if (matched.length === 0) {
    return { allowedTypes: null, seeAmounts: true, settings };
  }

  const allowedSet = new Set();
  let seeAmounts = false;
  for (const rule of matched) {
    for (const t of rule.types || []) allowedSet.add(t);
    if (rule.see_amounts !== false) seeAmounts = true;
  }

  return {
    allowedTypes: [...allowedSet],
    seeAmounts,
    settings,
  };
};

// ── Date & filter builder ─────────────────────────────────────────────────────

const parseDateRange = (query = {}, timezone = DEFAULT_TIMEZONE) => {
  const preset = String(query.date || query.date_preset || "").toLowerCase();
  const offset = getTzOffsetString(timezone);
  const todayYmd = dayStringInTz(new Date(), timezone);

  const startOfDay = (ymd) => new Date(`${ymd}T00:00:00.000${offset}`);
  const endOfDay = (ymd) => new Date(`${ymd}T23:59:59.999${offset}`);
  const addDays = (ymd, delta) => {
    const d = new Date(`${ymd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  };

  if (preset === "today") {
    return { from: startOfDay(todayYmd), to: endOfDay(todayYmd), isToday: true };
  }
  if (preset === "yesterday") {
    const y = addDays(todayYmd, -1);
    return { from: startOfDay(y), to: endOfDay(y), isToday: false };
  }
  if (preset === "this_week") {
    const d = new Date(`${todayYmd}T12:00:00Z`);
    const day = d.getUTCDay(); // 0 Sun .. 6 Sat
    const mondayDelta = day === 0 ? -6 : 1 - day;
    const mon = addDays(todayYmd, mondayDelta);
    return { from: startOfDay(mon), to: endOfDay(todayYmd), isToday: false };
  }
  if (preset === "last_7_days") {
    const start = addDays(todayYmd, -6);
    return { from: startOfDay(start), to: endOfDay(todayYmd), isToday: false };
  }
  if (preset === "this_month") {
    const first = `${todayYmd.slice(0, 7)}-01`;
    return { from: startOfDay(first), to: endOfDay(todayYmd), isToday: false };
  }

  let from = null;
  let to = null;
  if (query.from) {
    from = /^\d{4}-\d{2}-\d{2}$/.test(String(query.from))
      ? startOfDay(String(query.from))
      : new Date(query.from);
  }
  if (query.to) {
    to = /^\d{4}-\d{2}-\d{2}$/.test(String(query.to))
      ? endOfDay(String(query.to))
      : new Date(query.to);
  }
  const isToday =
    Boolean(from && to) &&
    dayStringInTz(from, timezone) === todayYmd &&
    dayStringInTz(to, timezone) === todayYmd;

  return {
    from: from && !Number.isNaN(from.getTime()) ? from : null,
    to: to && !Number.isNaN(to.getTime()) ? to : null,
    isToday,
  };
};

const normalizeTypesFilter = (rawTypes, allowedTypes) => {
  let requested = null;
  if (Array.isArray(rawTypes)) {
    requested = rawTypes.flatMap((t) => String(t).split(",")).map((s) => s.trim()).filter(Boolean);
  } else if (typeof rawTypes === "string" && rawTypes.trim()) {
    requested = rawTypes.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (requested && requested.length > 0) {
    const valid = requested.filter((t) => ACTIVITY_EVENT_TYPES.includes(t));
    if (allowedTypes) {
      const allowedSet = new Set(allowedTypes);
      return valid.filter((t) => allowedSet.has(t));
    }
    return valid;
  }
  return allowedTypes;
};

const buildActivityWhere = (models, query = {}, { userId, allowedTypes } = {}) => {
  const where = {};

  const types = normalizeTypesFilter(query.types ?? query["types[]"], allowedTypes);
  if (types !== null) {
    where.type = { [Op.in]: types.length > 0 ? types : ["__none__"] };
  }

  const { from, to, isToday } = parseDateRange(query);
  if (from && to) {
    where.occurred_at = { [Op.between]: [from, to] };
  } else if (from) {
    where.occurred_at = { [Op.gte]: from };
  } else if (to) {
    where.occurred_at = { [Op.lte]: to };
  }

  const staffId = query.staff ?? query.actor_user_id;
  if (staffId) {
    where.actor_user_id = Number(staffId);
  }

  if (query.customer_id) {
    where.customer_id = Number(query.customer_id);
  }

  if (query.invoice) {
    const invNum = String(query.invoice).replace(/[^0-9]/g, "");
    if (invNum) {
      where.invoice_id = Number(invNum);
    } else {
      where.invoice_id = -1;
    }
  }

  if (query.amount_min !== undefined && query.amount_min !== "" && query.amount_min !== null) {
    const min = Number(query.amount_min);
    if (Number.isFinite(min)) {
      where.amount = { [Op.gte]: min };
    }
  }

  if (query.risk === "high" || query.risk === "normal") {
    where.risk = query.risk;
  }

  if (query.checked === true || query.checked === "true") {
    where.checked_at = { [Op.ne]: null };
  } else if (query.checked === false || query.checked === "false") {
    where.checked_at = null;
  }

  if (query.after_hours === true || query.after_hours === "true") {
    where.after_hours = true;
  } else if (query.after_hours === false || query.after_hours === "false") {
    where.after_hours = false;
  }

  if ((query.unread === true || query.unread === "true") && userId && models?.sequelize) {
    const escapedUid = models.sequelize.escape(Number(userId));
    where[Op.and] = [
      ...(where[Op.and] || []),
      models.sequelize.literal(
        `NOT EXISTS (SELECT 1 FROM ACTIVITY_EVENT_READS r WHERE r.event_id = ActivityEvent.event_id AND r.user_id = ${escapedUid})`,
      ),
    ];
  }

  return { where, isToday, from, to };
};

// A role that may not see amounts must not read them inside the one-line sentence either.
export const maskAmounts = (text) => String(text || "").replace(/Rs\.?\s?\d[\d,]*(\.\d+)?/g, "Rs •••");

const maskSentence = (sentence) =>
  sentence && typeof sentence === "object"
    ? { en: maskAmounts(sentence.en), si: maskAmounts(sentence.si) }
    : maskAmounts(sentence);

// Free-text customer filter: name, company, phone or NIC.
const applyCustomerSearch = async (models, query, where) => {
  const text = String(query.customer || "").trim();
  if (!text || query.customer_id || !models.Customer?.findAll) return where;
  const like = { [Op.like]: `%${text.replace(/[\\%_]/g, "\\$&")}%` };
  const words = text.split(/\s+/);
  const rows = await models.Customer.findAll({
    attributes: ["customer_id"],
    where: {
      [Op.or]: [
        { first_name: like },
        { last_name: like },
        { company_name: like },
        { phone_number: like },
        { nic_number: like },
        ...(words.length > 1
          ? [{ first_name: { [Op.like]: `%${words[0]}%` }, last_name: { [Op.like]: `%${words.slice(1).join(" ")}%` } }]
          : []),
      ],
    },
    limit: 500,
    raw: true,
  });
  where.customer_id = { [Op.in]: rows.length > 0 ? rows.map((r) => r.customer_id) : [-1] };
  return where;
};

const formatEventRow = (row, { commentCount = 0, isRead = false, seeAmounts = true } = {}) => {
  const plain = typeof row.toJSON === "function" ? row.toJSON() : { ...row };
  const data = parseJsonField(plain.data, {});
  const rawSentence = data?.sentence || { en: "", si: "" };
  const sentence = seeAmounts ? rawSentence : maskSentence(rawSentence);
  return {
    event_id: plain.event_id,
    type: plain.type,
    risk: plain.risk,
    invoice_id: plain.invoice_id,
    customer_id: plain.customer_id,
    actor_user_id: plain.actor_user_id,
    actor_name: plain.Actor ? formatStaffDisplay(plain.Actor) : data?.staff_name || null,
    customer_name: plain.Customer ? formatCustomerDisplay(plain.Customer) : data?.customer_name || null,
    amount: seeAmounts && plain.amount !== null && plain.amount !== undefined ? Number(plain.amount) : null,
    sentence,
    data: seeAmounts ? data : { ...data, sentence, old_amount: undefined, new_amount: undefined },
    occurred_at: plain.occurred_at,
    after_hours: Boolean(plain.after_hours),
    checked_by: plain.checked_by,
    checked_by_name: plain.CheckedBy ? formatStaffDisplay(plain.CheckedBy) : null,
    checked_at: plain.checked_at,
    created_at: plain.created_at,
    comment_count: Number(commentCount || 0),
    is_read: Boolean(isRead),
  };
};

// ── Activity API Service Methods ──────────────────────────────────────────────

export const listActivity = async (models, query = {}, { userId, roleIds = null } = {}) => {
  const { allowedTypes, seeAmounts } = await resolveUserActivityVisibility(models, userId, roleIds);
  const { where } = buildActivityWhere(models, query, { userId, allowedTypes });
  await applyCustomerSearch(models, query, where);

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const { count, rows } = await models.ActivityEvent.findAndCountAll({
    where,
    include: [
      ...(models.User
        ? [
            { model: models.User, as: "Actor", attributes: ["user_id", "first_name", "last_name", "username"], required: false },
            { model: models.User, as: "CheckedBy", attributes: ["user_id", "first_name", "last_name", "username"], required: false },
          ]
        : []),
      ...(models.Customer
        ? [{ model: models.Customer, attributes: ["customer_id", "first_name", "last_name", "company_name", "customer_type"], required: false }]
        : []),
    ],
    distinct: true,
    col: "event_id",
    order: [
      ["occurred_at", "DESC"],
      ["event_id", "DESC"],
    ],
    limit,
    offset,
  });

  const eventIds = rows.map((r) => r.event_id);
  const commentCounts = new Map();
  const readSet = new Set();

  if (eventIds.length > 0) {
    const [commentRows, readRows] = await Promise.all([
      models.ActivityEventComment?.findAll
        ? models.ActivityEventComment.findAll({
            attributes: [
              "event_id",
              [models.sequelize.fn("COUNT", models.sequelize.col("comment_id")), "cnt"],
            ],
            where: { event_id: { [Op.in]: eventIds } },
            group: ["event_id"],
            raw: true,
          })
        : Promise.resolve([]),
      userId && models.ActivityEventRead?.findAll
        ? models.ActivityEventRead.findAll({
            attributes: ["event_id"],
            where: { event_id: { [Op.in]: eventIds }, user_id: userId },
            raw: true,
          })
        : Promise.resolve([]),
    ]);

    for (const c of commentRows || []) {
      commentCounts.set(Number(c.event_id), Number(c.cnt || 0));
    }
    for (const r of readRows || []) {
      readSet.add(Number(r.event_id));
    }
  }

  return {
    total: Number(count || 0),
    page,
    limit,
    see_amounts: seeAmounts,
    events: rows.map((row) =>
      formatEventRow(row, {
        commentCount: commentCounts.get(Number(row.event_id)) || 0,
        isRead: readSet.has(Number(row.event_id)),
        seeAmounts,
      }),
    ),
  };
};

export const getActivitySummary = async (
  models,
  query = {},
  { userId, roleIds = null, canCheck = false } = {},
) => {
  const { allowedTypes, seeAmounts, settings } = await resolveUserActivityVisibility(models, userId, roleIds);
  const { where, isToday } = buildActivityWhere(models, query, { userId, allowedTypes });
  await applyCustomerSearch(models, query, where);
  const sequelize = models.sequelize;
  const tzOffset = getTzOffsetString(settings.timezone);

  const bucketExpr = isToday
    ? sequelize.fn(
        "DATE_FORMAT",
        sequelize.fn("CONVERT_TZ", sequelize.col("occurred_at"), "+00:00", tzOffset),
        "%Y-%m-%d %H:00",
      )
    : sequelize.fn(
        "DATE_FORMAT",
        sequelize.fn("CONVERT_TZ", sequelize.col("occurred_at"), "+00:00", tzOffset),
        "%Y-%m-%d",
      );

  const STAFF_TYPES = ["discount", "backdated_payment", "backdated_bill", "backdated_return", "refund"];

  const [byTypeRows, bucketRows, notCheckedCount, staffRows, highNotCheckedCount] = await Promise.all([
    models.ActivityEvent.findAll({
      attributes: [
        "type",
        [sequelize.fn("COUNT", sequelize.col("event_id")), "count"],
        [sequelize.fn("COALESCE", sequelize.fn("SUM", sequelize.col("amount")), 0), "amount"],
        [
          sequelize.fn(
            "SUM",
            sequelize.literal("CASE WHEN `risk` = 'high' THEN 1 ELSE 0 END"),
          ),
          "high_count",
        ],
      ],
      where,
      group: ["type"],
      raw: true,
    }),
    models.ActivityEvent.findAll({
      attributes: [
        [bucketExpr, "bucket"],
        "type",
        [sequelize.fn("COUNT", sequelize.col("event_id")), "count"],
        [sequelize.fn("COALESCE", sequelize.fn("SUM", sequelize.col("amount")), 0), "amount"],
      ],
      where,
      group: [bucketExpr, "type"],
      order: [[sequelize.literal("bucket"), "ASC"]],
      raw: true,
    }),
    models.ActivityEvent.count({
      where: {
        ...where,
        checked_at: null,
      },
    }),
    canCheck
      ? models.ActivityEvent.findAll({
          attributes: [
            "actor_user_id",
            "type",
            [sequelize.fn("COUNT", sequelize.col("event_id")), "count"],
            [sequelize.fn("COALESCE", sequelize.fn("SUM", sequelize.col("amount")), 0), "amount"],
          ],
          where: {
            ...where,
            actor_user_id: { [Op.ne]: null },
            ...(where.type ? {} : { type: { [Op.in]: STAFF_TYPES } }),
          },
          group: ["actor_user_id", "type"],
          raw: true,
        })
      : Promise.resolve([]),
    models.ActivityEvent.count({
      where: {
        ...where,
        checked_at: null,
        // Keep an existing risk filter: "normal only" has no High events.
        risk: where.risk && where.risk !== "high" ? "__none__" : "high",
      },
    }),
  ]);

  const by_type = {};
  let totalCount = 0;
  let totalAmount = 0;
  let totalHigh = 0;

  for (const r of byTypeRows || []) {
    const cnt = Number(r.count || 0);
    const amt = seeAmounts ? Number(r.amount || 0) : 0;
    const high = Number(r.high_count || 0);
    by_type[r.type] = { count: cnt, amount: amt, high_count: high };
    totalCount += cnt;
    totalAmount += amt;
    totalHigh += high;
  }

  const bucketsMap = new Map();
  for (const r of bucketRows || []) {
    const key = String(r.bucket || "");
    if (!bucketsMap.has(key)) {
      bucketsMap.set(key, { bucket: key, types: {}, total_count: 0 });
    }
    const entry = bucketsMap.get(key);
    const cnt = Number(r.count || 0);
    entry.types[r.type] = {
      count: cnt,
      amount: seeAmounts ? Number(r.amount || 0) : 0,
    };
    entry.total_count += cnt;
  }

  let by_staff = null;
  if (canCheck) {
    const staffIds = [...new Set((staffRows || []).map((r) => Number(r.actor_user_id)).filter(Boolean))];
    const users =
      staffIds.length > 0 && models.User?.findAll
        ? await models.User.findAll({
            where: { user_id: { [Op.in]: staffIds } },
            attributes: ["user_id", "first_name", "last_name", "username"],
          })
        : [];
    const userMap = new Map((users || []).map((u) => [Number(u.user_id), formatStaffDisplay(u)]));
    const staffMap = new Map();
    for (const r of staffRows || []) {
      const uid = Number(r.actor_user_id);
      if (!STAFF_TYPES.includes(r.type)) continue;
      if (!staffMap.has(uid)) {
        staffMap.set(uid, {
          user_id: uid,
          name: userMap.get(uid) || `User ${uid}`,
          discounts: 0,
          backdated: 0,
          refunds: 0,
          total: 0,
        });
      }
      const s = staffMap.get(uid);
      const cnt = Number(r.count || 0);
      if (r.type === "discount") s.discounts += cnt;
      else if (["backdated_payment", "backdated_bill", "backdated_return"].includes(r.type)) s.backdated += cnt;
      else if (r.type === "refund") s.refunds += cnt;
      s.total += cnt;
    }
    by_staff = [...staffMap.values()].sort((a, b) => b.total - a.total);
  }

  return {
    granularity: isToday ? "hour" : "day",
    see_amounts: seeAmounts,
    totals: {
      count: totalCount,
      amount: seeAmounts ? totalAmount : 0,
      high_count: totalHigh,
      not_checked: Number(notCheckedCount || 0),
    },
    by_type,
    buckets: [...bucketsMap.values()],
    not_checked: Number(notCheckedCount || 0),
    high_not_checked: Number(highNotCheckedCount || 0),
    by_staff,
  };
};

export const checkEvent = async (models, eventId, userId) => {
  const event = await models.ActivityEvent.findByPk(eventId);
  if (!event) throw new AppError("Activity event not found.", 404);
  if (!event.checked_at) {
    await event.update({ checked_by: userId, checked_at: new Date() });
  }
  return event;
};

export const uncheckEvent = async (models, eventId) => {
  const event = await models.ActivityEvent.findByPk(eventId);
  if (!event) throw new AppError("Activity event not found.", 404);
  if (event.checked_at) {
    await event.update({ checked_by: null, checked_at: null });
  }
  return event;
};

export const listComments = async (models, eventId) => {
  const event = await models.ActivityEvent.findByPk(eventId);
  if (!event) throw new AppError("Activity event not found.", 404);

  const rows = await models.ActivityEventComment.findAll({
    where: { event_id: eventId },
    include: models.User
      ? [{ model: models.User, as: "Author", attributes: ["user_id", "first_name", "last_name", "username"], required: false }]
      : [],
    order: [["created_at", "ASC"], ["comment_id", "ASC"]],
  });

  return rows.map((c) => {
    const plain = typeof c.toJSON === "function" ? c.toJSON() : { ...c };
    return {
      comment_id: plain.comment_id,
      event_id: plain.event_id,
      user_id: plain.user_id,
      author_name: plain.Author ? formatStaffDisplay(plain.Author) : `User ${plain.user_id}`,
      body: plain.body,
      created_at: plain.created_at,
    };
  });
};

export const addComment = async (models, eventId, userId, body) => {
  const cleanBody = String(body || "").trim();
  if (!cleanBody) throw new AppError("Comment body is required.", 400);

  const event = await models.ActivityEvent.findByPk(eventId);
  if (!event) throw new AppError("Activity event not found.", 404);

  const created = await models.ActivityEventComment.create({
    event_id: Number(eventId),
    user_id: Number(userId),
    body: cleanBody,
  });

  if (event.actor_user_id && Number(event.actor_user_id) !== Number(userId)) {
    try {
      const commenter = models.User?.findByPk
        ? await models.User.findByPk(userId, { attributes: ["user_id", "first_name", "last_name", "username"] })
        : null;
      const commenterName = formatStaffDisplay(commenter);
      await createNotification(models, {
        userId: Number(event.actor_user_id),
        type: "info",
        category: "activity",
        title: `${commenterName} commented on ${event.invoice_id ? `INV-${event.invoice_id}` : "an activity event"}`,
        message: cleanBody.slice(0, 200),
        payload: { event_id: Number(eventId), invoice_id: event.invoice_id },
        link: event.invoice_id ? `/invoices?mode=manage&invoiceId=${event.invoice_id}` : "/activity",
      });
    } catch {
      // Non-fatal
    }
  }

  return created;
};

export const markRead = async (models, eventIds, userId) => {
  const ids = [...new Set((Array.isArray(eventIds) ? eventIds : []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (ids.length === 0 || !userId) return { marked: 0 };

  const now = new Date();
  let marked = 0;
  for (const eventId of ids) {
    const existing = await models.ActivityEventRead.findOne({
      where: { event_id: eventId, user_id: userId },
    });
    if (!existing) {
      await models.ActivityEventRead.create({
        event_id: eventId,
        user_id: userId,
        read_at: now,
      });
      marked += 1;
    }
  }
  return { marked };
};

export const exportActivityExcel = async (models, query = {}, { userId, roleIds = null } = {}) => {
  const { allowedTypes, seeAmounts } = await resolveUserActivityVisibility(models, userId, roleIds);
  const { where } = buildActivityWhere(models, query, { userId, allowedTypes });
  await applyCustomerSearch(models, query, where);

  const rows = await models.ActivityEvent.findAll({
    where,
    include: [
      ...(models.User
        ? [
            { model: models.User, as: "Actor", attributes: ["user_id", "first_name", "last_name", "username"], required: false },
            { model: models.User, as: "CheckedBy", attributes: ["user_id", "first_name", "last_name", "username"], required: false },
          ]
        : []),
      ...(models.Customer
        ? [{ model: models.Customer, attributes: ["customer_id", "first_name", "last_name", "company_name", "customer_type"], required: false }]
        : []),
    ],
    order: [
      ["occurred_at", "DESC"],
      ["event_id", "DESC"],
    ],
    limit: 5000,
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Activity");
  ws.columns = [
    { header: "Event ID", key: "event_id", width: 12 },
    { header: "Occurred At", key: "occurred_at", width: 22 },
    { header: "Type", key: "type", width: 22 },
    { header: "Risk", key: "risk", width: 10 },
    { header: "After Hours", key: "after_hours", width: 12 },
    { header: "Bill", key: "invoice_id", width: 12 },
    { header: "Customer", key: "customer", width: 24 },
    { header: "Staff", key: "staff", width: 20 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Summary", key: "sentence", width: 48 },
    { header: "Checked By", key: "checked_by", width: 20 },
    { header: "Checked At", key: "checked_at", width: 22 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    const formatted = formatEventRow(r, { seeAmounts });
    ws.addRow({
      event_id: formatted.event_id,
      occurred_at: formatted.occurred_at ? new Date(formatted.occurred_at).toISOString() : "",
      type: formatted.type,
      risk: formatted.risk,
      after_hours: formatted.after_hours ? "Yes" : "No",
      invoice_id: formatted.invoice_id ? `INV-${formatted.invoice_id}` : "",
      customer: formatted.customer_name || "",
      staff: formatted.actor_name || "",
      amount: seeAmounts && formatted.amount !== null ? formatted.amount : "",
      sentence: formatted.sentence?.en || "",
      checked_by: formatted.checked_by_name || "",
      checked_at: formatted.checked_at ? new Date(formatted.checked_at).toISOString() : "",
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
};
