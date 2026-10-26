// WhatsApp hub — free click-to-chat integration.
//
// Nothing here talks to Meta. The server composes the message (template + the invoice's real
// numbers), works out the customer's WhatsApp number, and returns a wa.me link; staff tap it,
// WhatsApp opens with the text filled in, and they press send. That is the only way to message
// customers for free: anything the *business* starts through the official Cloud API is billed
// per message. Every opened chat is logged so nobody gets nagged twice.

import { Op, QueryTypes } from "sequelize";
import AppError from "../utils/AppError.js";
import { PAID_PER_INVOICE_SQL } from "../utils/invoiceBalance.js";
import { pickWhatsAppNumber, buildWaLink } from "../utils/whatsappPhone.js";
import {
  DEFAULT_TEMPLATES,
  LANGUAGES,
  MAX_TEMPLATE_LENGTH,
  PLACEHOLDERS,
  SAMPLE_VARS,
  TEMPLATE_KEYS,
  TEMPLATE_META,
  renderTemplate,
  unknownPlaceholders,
} from "../utils/whatsappTemplates.js";

export const DEFAULT_TZ = "Asia/Colombo";
const RECENT_MESSAGE_HOURS = 12;
const LANGUAGE_MEMORY_DAYS = 30;
const MAX_ITEM_LINES = 6;
const WORKLIST_LIMIT = 300;
// Browsers and WhatsApp cope with very long links, but past this the text is likely to be cut.
const MAX_LINK_LENGTH = 6000;

// ─── small pure helpers ──────────────────────────────────────────────────────

const parseJson = (v) => {
  if (!v) return {};
  if (typeof v === "string") {
    try {
      return JSON.parse(v) || {};
    } catch {
      return {};
    }
  }
  return v;
};

export const formatMoney = (n) => {
  const x = Number(n || 0);
  return `Rs. ${Number.isInteger(x) ? x.toLocaleString("en-US") : x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 'YYYY-MM-DD' (a DATEONLY) or a Date → "26 Oct 2026" in the shop's timezone. */
export const formatDate = (value, tz = DEFAULT_TZ) => {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" });
};

/** Today as 'YYYY-MM-DD' in the shop's timezone. */
export const todayInTz = (tz = DEFAULT_TZ, now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // en-CA → YYYY-MM-DD
};

const toUtcMs = (dateStr) => {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export const addDays = (dateStr, n) => {
  const dt = new Date(toUtcMs(dateStr) + n * 86400000);
  return dt.toISOString().slice(0, 10);
};

/** whole days from a to b (b − a) */
export const daysBetween = (a, b) => Math.round((toUtcMs(b) - toUtcMs(a)) / 86400000);

const toDateStr = (v) => {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

export const customerDisplayName = (c) => {
  if (!c) return "";
  if (c.customer_type === "Business" && c.company_name) return String(c.company_name).trim();
  const person = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return person || (c.company_name ? String(c.company_name).trim() : "");
};

export const invoiceNumber = (id) => `INV-${id}`;

const equipmentLabel = (equipment, language) => {
  if (!equipment) return "Equipment";
  const name = (language === "si" && equipment.equipment_name_si) || equipment.equipment_name || "Equipment";
  return equipment.serial_number ? `${name} (${equipment.serial_number})` : name;
};

/**
 * Bullet list of machines. `pendingOnly` (return reminders) lists only what is still out,
 * with the outstanding quantity; otherwise the whole order.
 */
export const buildItemsList = (lines, { language = "en", pendingOnly = false } = {}) => {
  const rows = [];
  for (const l of lines || []) {
    const qty = pendingOnly
      ? Number(l.borrow_quantity || 0) - Number(l.good_returned_qty || 0) - Number(l.defective_returned_qty || 0)
      : Number(l.borrow_quantity || 0);
    if (qty <= 0) continue;
    rows.push(`• ${qty} × ${equipmentLabel(l.Equipment || l.equipment, language)}`);
  }
  if (rows.length <= MAX_ITEM_LINES) return rows.join("\n");
  const hidden = rows.length - MAX_ITEM_LINES;
  return [...rows.slice(0, MAX_ITEM_LINES), language === "si" ? `… තවත් ${hidden}ක්` : `… +${hidden} more`].join("\n");
};

const pendingUnits = (lines) =>
  (lines || []).reduce(
    (s, l) => s + Math.max(0, Number(l.borrow_quantity || 0) - Number(l.good_returned_qty || 0) - Number(l.defective_returned_qty || 0)),
    0,
  );

// ─── template storage ────────────────────────────────────────────────────────

const tplKey = (key, lang) => `${key}:${lang}`;

const loadTemplateMap = async (models) => {
  const rows = await models.WhatsappTemplate.findAll();
  return new Map(rows.map((r) => [tplKey(r.template_key, r.language), r.body]));
};

const templateBody = (templateMap, key, language) =>
  templateMap.get(tplKey(key, language)) ?? DEFAULT_TEMPLATES[key]?.[language] ?? DEFAULT_TEMPLATES[key]?.en ?? "";

const assertTemplateKey = (key) => {
  if (!TEMPLATE_KEYS.includes(key)) throw new AppError(`Unknown message type "${key}".`, 400);
};
const assertLanguage = (lang) => {
  if (!LANGUAGES.includes(lang)) throw new AppError(`Unsupported language "${lang}".`, 400);
};

export const getTemplates = async (models) => {
  const map = await loadTemplateMap(models);
  const templates = {};
  for (const key of TEMPLATE_KEYS) {
    templates[key] = {};
    for (const lang of LANGUAGES) {
      const custom = map.get(tplKey(key, lang));
      templates[key][lang] = {
        body: custom ?? DEFAULT_TEMPLATES[key][lang],
        default_body: DEFAULT_TEMPLATES[key][lang],
        is_custom: custom !== undefined,
      };
    }
  }
  return {
    languages: LANGUAGES,
    keys: TEMPLATE_KEYS.map((key) => ({ key, group: TEMPLATE_META[key].group, needs_invoice: TEMPLATE_META[key].needsInvoice })),
    placeholders: PLACEHOLDERS,
    samples: SAMPLE_VARS,
    max_length: MAX_TEMPLATE_LENGTH,
    templates,
  };
};

export const saveTemplate = async (models, { key, language, body, userId }) => {
  assertTemplateKey(key);
  assertLanguage(language);
  const text = String(body ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) throw new AppError("The message cannot be empty.", 400);
  if (text.length > MAX_TEMPLATE_LENGTH) throw new AppError(`The message is too long (max ${MAX_TEMPLATE_LENGTH} characters).`, 400);
  const bad = unknownPlaceholders(text);
  if (bad.length) throw new AppError(`Unknown placeholder(s): ${bad.map((b) => `{{${b}}}`).join(", ")}.`, 400);

  const existing = await models.WhatsappTemplate.findOne({ where: { template_key: key, language } });
  if (existing) await existing.update({ body: text, updated_by_user_id: userId ?? null });
  else await models.WhatsappTemplate.create({ template_key: key, language, body: text, updated_by_user_id: userId ?? null });
  return { key, language, body: text, is_custom: true };
};

export const resetTemplate = async (models, { key, language }) => {
  assertTemplateKey(key);
  assertLanguage(language);
  await models.WhatsappTemplate.destroy({ where: { template_key: key, language } });
  return { key, language, body: DEFAULT_TEMPLATES[key][language], is_custom: false };
};

// ─── shop settings (phone shown in messages, default language) ───────────────

export const getShopContext = async (models) => {
  const config = await models.TenantConfig.findOne();
  const custom = parseJson(config?.custom_settings);
  const wa = parseJson(custom.whatsapp);
  const lang = LANGUAGES.includes(wa.default_language) ? wa.default_language : "en";
  return {
    shop_name: config?.business_display_name || "",
    shop_phone: (wa.shop_phone ?? custom.contact_phone ?? custom.phone ?? "").toString().trim(),
    default_language: lang,
    timezone: config?.timezone || DEFAULT_TZ,
  };
};

export const getSettings = async (models) => {
  const ctx = await getShopContext(models);
  return { shop_name: ctx.shop_name, shop_phone: ctx.shop_phone, default_language: ctx.default_language };
};

export const updateSettings = async (models, { shop_phone, default_language }) => {
  if (default_language !== undefined) assertLanguage(default_language);
  if (shop_phone !== undefined && String(shop_phone).length > 30) throw new AppError("Phone number is too long.", 400);

  let config = await models.TenantConfig.findOne();
  if (!config) config = await models.TenantConfig.create({ business_display_name: "My Rental Co" });
  const custom = parseJson(config.custom_settings);
  const wa = { ...parseJson(custom.whatsapp) };
  if (shop_phone !== undefined) wa.shop_phone = String(shop_phone).trim();
  if (default_language !== undefined) wa.default_language = default_language;
  await config.update({ custom_settings: { ...custom, whatsapp: wa } });
  return getSettings(models);
};

// ─── message building (pure) ─────────────────────────────────────────────────

/**
 * @param {object} p
 * @param {'receipt'|'pending'} p.mode  receipt = whole order; pending = only what is still out
 */
export const buildVars = ({ shop, customer, invoice, lines, paid, language, dueDate, today }) => {
  const total = Number(invoice?.total_amount || 0);
  const paidAmt = Number(paid || 0);
  const advance = Number(invoice?.advance_paid || 0);
  const pendingOnly = !!dueDate;
  const lateDays = dueDate && today ? Math.max(0, daysBetween(dueDate, today)) : 0;
  return {
    customer_name: customerDisplayName(customer),
    shop_name: shop.shop_name,
    shop_phone: shop.shop_phone,
    invoice_number: invoice ? invoiceNumber(invoice.invoice_id) : "",
    issued_date: invoice ? formatDate(invoice.issued_date, shop.timezone) : "",
    items: buildItemsList(lines, { language, pendingOnly }),
    item_count: String(pendingOnly ? pendingUnits(lines) : (lines || []).reduce((s, l) => s + Number(l.borrow_quantity || 0), 0)),
    total: invoice ? formatMoney(total) : "",
    paid: invoice ? formatMoney(paidAmt) : "",
    balance: invoice ? formatMoney(Math.max(0, total - paidAmt)) : "",
    advance: advance > 0 ? formatMoney(advance) : "",
    return_date: dueDate ? formatDate(dueDate, shop.timezone) : "",
    days_late: lateDays > 0 ? String(lateDays) : "",
  };
};

const buildWarnings = ({ number, optedOut, balance, key, recent, link, nothingToReturn = false }) => {
  const w = [];
  if (!number.digits) w.push(number.display ? "invalid_phone" : "no_phone"); // junk text vs. nothing at all
  else if (number.kind === "landline") w.push("landline");
  else if (!number.valid) w.push("invalid_phone");
  if (optedOut) w.push("opted_out");
  if (key === "payment_reminder" && balance <= 0) w.push("no_balance");
  if (nothingToReturn) w.push("nothing_to_return");
  if (recent) w.push("messaged_recently");
  if (link.length > MAX_LINK_LENGTH) w.push("too_long");
  return w;
};

const isRecent = (log, key, now = new Date()) =>
  !!log && log.template_key === key && now.getTime() - new Date(log.createdAt).getTime() < RECENT_MESSAGE_HOURS * 3600 * 1000;

// ─── compose one message ─────────────────────────────────────────────────────

const lastLanguageFor = async (models, customerId) => {
  const since = new Date(Date.now() - LANGUAGE_MEMORY_DAYS * 86400000);
  const row = await models.WhatsappMessageLog.findOne({
    where: { customer_id: customerId, createdAt: { [Op.gte]: since } },
    order: [["createdAt", "DESC"], ["log_id", "DESC"]],
  });
  return row && LANGUAGES.includes(row.language) ? row.language : null;
};

/** Which date a return reminder talks about: the earliest due date among lines still out. */
const earliestPendingDue = (lines) => {
  let min = null;
  for (const l of lines) {
    const pending = Number(l.borrow_quantity || 0) - Number(l.good_returned_qty || 0) - Number(l.defective_returned_qty || 0);
    if (pending <= 0 || l.track_overdue === false || l.track_overdue === 0) continue;
    const d = toDateStr(l.expected_return_date);
    if (d && (!min || d < min)) min = d;
  }
  return min;
};

export const composeMessage = async (models, { template_key, invoice_id, customer_id, language, custom_text } = {}) => {
  assertTemplateKey(template_key);
  const meta = TEMPLATE_META[template_key];
  if (meta.needsInvoice && !invoice_id) throw new AppError("An invoice is required for this message type.", 400);
  if (!meta.needsInvoice && !invoice_id && !customer_id) throw new AppError("Pick a customer or an invoice.", 400);
  if (language !== undefined && language !== null && language !== "") assertLanguage(language);

  let invoice = null;
  let lines = [];
  let paid = 0;
  if (invoice_id) {
    invoice = await models.Invoice.findByPk(invoice_id);
    if (!invoice) throw new AppError("Invoice not found.", 404);
    lines = await models.InvoiceLine.findAll({
      where: { invoice_id },
      include: [{ model: models.Equipment, attributes: ["equipment_name", "equipment_name_si", "serial_number"] }],
    });
    const payments = await models.Payment.findAll({ where: { invoice_id, is_voided: false } });
    paid = payments.reduce((s, p) => s + Number(p.payment_amount || 0), 0);
  }

  const customerId = invoice ? invoice.customer_id : customer_id;
  const customer = await models.Customer.findByPk(customerId);
  if (!customer) throw new AppError("Customer not found.", 404);

  const shop = await getShopContext(models);
  const lang = language || (await lastLanguageFor(models, customerId)) || shop.default_language;
  const templateMap = await loadTemplateMap(models);
  const today = todayInTz(shop.timezone);

  const returnMessage = ["return_due_tomorrow", "return_due_today", "overdue_return"].includes(template_key);
  const dueDate = returnMessage ? earliestPendingDue(lines) : null;
  const vars = buildVars({ shop, customer, invoice, lines, paid, language: lang, dueDate, today });

  // A custom message is whatever staff typed; everything else is the shop's template filled in.
  const typed = template_key === "custom" && custom_text !== undefined && custom_text !== null ? String(custom_text).trim() : "";
  const body = typed || renderTemplate(templateBody(templateMap, template_key, lang), vars);

  const number = pickWhatsAppNumber(customer.phone_number);
  const link = buildWaLink(number.valid ? number.digits : "", body);
  const lastLog = await models.WhatsappMessageLog.findOne({
    where: invoice ? { invoice_id: invoice.invoice_id } : { customer_id: customerId },
    order: [["createdAt", "DESC"], ["log_id", "DESC"]],
  });
  const total = Number(invoice?.total_amount || 0);

  return {
    template_key,
    language: lang,
    body,
    link,
    to: { digits: number.digits, display: number.display, kind: number.kind, valid: number.valid },
    customer: { customer_id: customer.customer_id, name: customerDisplayName(customer), opted_out: !!customer.whatsapp_opt_out },
    invoice: invoice ? { invoice_id: invoice.invoice_id, number: invoiceNumber(invoice.invoice_id), balance: Math.max(0, total - paid) } : null,
    last_message: lastLog ? { template_key: lastLog.template_key, created_at: lastLog.createdAt, status: lastLog.status } : null,
    warnings: buildWarnings({
      number,
      optedOut: !!customer.whatsapp_opt_out,
      balance: total - paid,
      key: template_key,
      recent: isRecent(lastLog, template_key),
      link,
      nothingToReturn: returnMessage && !dueDate,
    }),
  };
};

// ─── log ─────────────────────────────────────────────────────────────────────

export const logMessage = async (models, { customer_id, invoice_id, template_key, language, to_phone, body, userId }) => {
  assertTemplateKey(template_key);
  if (language) assertLanguage(language);
  if (!String(body || "").trim()) throw new AppError("Message text is required.", 400);
  // may be empty: with no usable number WhatsApp opens its contact picker and staff choose the chat
  const digits = String(to_phone || "").replace(/\D/g, "");
  if (customer_id) {
    const customer = await models.Customer.findByPk(customer_id);
    if (customer?.whatsapp_opt_out) throw new AppError("This customer has asked not to be messaged on WhatsApp.", 409);
  }
  const row = await models.WhatsappMessageLog.create({
    customer_id: customer_id ?? null,
    invoice_id: invoice_id ?? null,
    template_key,
    language: language || "en",
    to_phone: digits.slice(0, 20),
    body: String(body),
    channel: "link",
    status: "opened",
    sent_by_user_id: userId ?? null,
  });
  return row;
};

export const confirmSent = async (models, logId) => {
  const row = await models.WhatsappMessageLog.findByPk(logId);
  if (!row) throw new AppError("Message log not found.", 404);
  await row.update({ status: "sent" });
  return row;
};

export const listLog = async (models, { customer_id, invoice_id, template_key, limit = 50, offset = 0 } = {}) => {
  const where = {};
  if (customer_id) where.customer_id = customer_id;
  if (invoice_id) where.invoice_id = invoice_id;
  if (template_key) where.template_key = template_key;
  const cap = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const { count, rows } = await models.WhatsappMessageLog.findAndCountAll({
    where,
    limit: cap,
    offset: Math.max(parseInt(offset, 10) || 0, 0),
    order: [["createdAt", "DESC"], ["log_id", "DESC"]],
  });

  const ids = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))];
  const names = new Map();
  if (ids.length) {
    const customers = await models.Customer.findAll({
      where: { customer_id: ids },
      attributes: ["customer_id", "first_name", "last_name", "company_name", "customer_type"],
    });
    for (const c of customers) names.set(c.customer_id, customerDisplayName(c));
  }
  return {
    total: count,
    entries: rows.map((r) => ({
      log_id: r.log_id,
      customer_id: r.customer_id,
      customer_name: names.get(r.customer_id) || "",
      invoice_id: r.invoice_id,
      invoice_number: r.invoice_id ? invoiceNumber(r.invoice_id) : null,
      template_key: r.template_key,
      language: r.language,
      to_phone: r.to_phone,
      body: r.body,
      status: r.status,
      created_at: r.createdAt,
      sent_by_user_id: r.sent_by_user_id,
    })),
  };
};

export const setOptOut = async (models, customerId, optOut) => {
  const customer = await models.Customer.findByPk(customerId);
  if (!customer) throw new AppError("Customer not found.", 404);
  await customer.update({ whatsapp_opt_out: !!optOut });
  return { customer_id: customer.customer_id, opted_out: !!optOut };
};

// ─── "Today" worklist ────────────────────────────────────────────────────────

// One query per section, each with its own cap. A single shared LIMIT let a pile of old, never-closed
// invoices fill the result and push out everything due today and tomorrow (found at 40k invoices).
const returnsSql = (having, order) => `
  SELECT i.invoice_id, i.customer_id, i.total_amount, i.advance_paid, i.issued_date,
         DATE_FORMAT(MIN(l.expected_return_date), '%Y-%m-%d') AS due_date
  FROM INVOICE_LINES l
  JOIN INVOICES i ON i.invoice_id = l.invoice_id
  WHERE i.is_deleted = 0 AND i.status = 'Active' AND l.track_overdue = 1
    AND (l.borrow_quantity - l.good_returned_qty - l.defective_returned_qty) > 0
  GROUP BY i.invoice_id, i.customer_id, i.total_amount, i.advance_paid, i.issued_date
  HAVING ${having}
  ORDER BY ${order}
  LIMIT ${WORKLIST_LIMIT + 1}`;

const OVERDUE_SQL = returnsSql("MIN(l.expected_return_date) < :today", "MIN(l.expected_return_date) ASC, i.invoice_id ASC");
const DUE_TODAY_SQL = returnsSql("MIN(l.expected_return_date) = :today", "i.invoice_id ASC");
const DUE_TOMORROW_SQL = returnsSql("MIN(l.expected_return_date) = :tomorrow", "i.invoice_id ASC");

const PAYMENTS_SQL = `
  SELECT i.invoice_id, i.customer_id, i.total_amount, i.advance_paid, i.issued_date,
         COALESCE(p.total_paid, 0) AS total_paid
  FROM INVOICES i
  LEFT JOIN ${PAID_PER_INVOICE_SQL} p ON p.invoice_id = i.invoice_id
  WHERE i.is_deleted = 0 AND i.status = 'PendingPayment'
    AND (i.total_amount - COALESCE(p.total_paid, 0)) > 0
  ORDER BY i.issued_date ASC, i.invoice_id ASC
  LIMIT ${WORKLIST_LIMIT + 1}`;

/**
 * What staff should chase today, ready to send: returns that are overdue / due today / due
 * tomorrow, and returned-but-unpaid invoices. Each row carries the composed message and link.
 */
export const getWorklist = async (models, { language, now = new Date() } = {}) => {
  if (language) assertLanguage(language);
  const shop = await getShopContext(models);
  const today = todayInTz(shop.timezone, now);
  const tomorrow = addDays(today, 1);
  const sequelize = models.sequelize;

  const run = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  const [overdueAll, todayAll, tomorrowAll, paymentAll] = await Promise.all([
    run(OVERDUE_SQL, { today }),
    run(DUE_TODAY_SQL, { today }),
    run(DUE_TOMORROW_SQL, { tomorrow }),
    run(PAYMENTS_SQL),
  ]);
  // each query asks for one row more than the cap, so we can tell "exactly 300" from "300 and more"
  const capped = (rows) => ({ rows: rows.slice(0, WORKLIST_LIMIT), truncated: rows.length > WORKLIST_LIMIT });
  const overdue = capped(overdueAll);
  const dueToday = capped(todayAll);
  const dueTomorrow = capped(tomorrowAll);
  const payments = capped(paymentAll);
  const truncated = {
    overdue_returns: overdue.truncated,
    returns_due_today: dueToday.truncated,
    returns_due_tomorrow: dueTomorrow.truncated,
    payments_pending: payments.truncated,
  };
  const returnRows = [...overdue.rows, ...dueToday.rows, ...dueTomorrow.rows];
  const paymentRows = payments.rows;

  const invoiceIds = [...new Set([...returnRows, ...paymentRows].map((r) => r.invoice_id))];
  const customerIds = [...new Set([...returnRows, ...paymentRows].map((r) => r.customer_id))];

  const empty = { generated_at: now.toISOString(), today, truncated, summary: { overdue_returns: 0, returns_due_today: 0, returns_due_tomorrow: 0, payments_pending: 0, balance_pending: 0 }, sections: { overdue_returns: [], returns_due_today: [], returns_due_tomorrow: [], payments_pending: [] } };
  if (!invoiceIds.length) return empty;

  const [customers, lines, logs, templateMap] = await Promise.all([
    models.Customer.findAll({
      where: { customer_id: customerIds },
      attributes: ["customer_id", "first_name", "last_name", "company_name", "customer_type", "phone_number", "whatsapp_opt_out"],
    }),
    models.InvoiceLine.findAll({
      where: { invoice_id: invoiceIds },
      include: [{ model: models.Equipment, attributes: ["equipment_name", "equipment_name_si", "serial_number"] }],
    }),
    models.WhatsappMessageLog.findAll({
      where: {
        createdAt: { [Op.gte]: new Date(now.getTime() - LANGUAGE_MEMORY_DAYS * 86400000) },
        [Op.or]: [{ invoice_id: invoiceIds }, { customer_id: customerIds }],
      },
      order: [["createdAt", "DESC"], ["log_id", "DESC"]],
    }),
    loadTemplateMap(models),
  ]);

  const customerById = new Map(customers.map((c) => [c.customer_id, c]));
  const linesByInvoice = new Map();
  for (const l of lines) {
    if (!linesByInvoice.has(l.invoice_id)) linesByInvoice.set(l.invoice_id, []);
    linesByInvoice.get(l.invoice_id).push(l);
  }
  const lastByInvoice = new Map();
  const languageByCustomer = new Map();
  for (const lg of logs) {
    if (lg.invoice_id && !lastByInvoice.has(lg.invoice_id)) lastByInvoice.set(lg.invoice_id, lg);
    if (lg.customer_id && !languageByCustomer.has(lg.customer_id) && LANGUAGES.includes(lg.language)) languageByCustomer.set(lg.customer_id, lg.language);
  }

  const buildItem = (row, key, { dueDate = null, paid = null }) => {
    const customer = customerById.get(row.customer_id);
    const invLines = linesByInvoice.get(row.invoice_id) || [];
    const lang = language || languageByCustomer.get(row.customer_id) || shop.default_language;
    const total = Number(row.total_amount || 0);
    const paidAmt = paid === null ? 0 : Number(paid);
    const vars = buildVars({ shop, customer, invoice: row, lines: invLines, paid: paidAmt, language: lang, dueDate, today });
    const body = renderTemplate(templateBody(templateMap, key, lang), vars);
    const number = pickWhatsAppNumber(customer?.phone_number);
    const link = buildWaLink(number.valid ? number.digits : "", body);
    const last = lastByInvoice.get(row.invoice_id) || null;
    return {
      invoice_id: row.invoice_id,
      invoice_number: invoiceNumber(row.invoice_id),
      customer: {
        customer_id: row.customer_id,
        name: customerDisplayName(customer),
        phone: { digits: number.digits, display: number.display, kind: number.kind, valid: number.valid },
        opted_out: !!customer?.whatsapp_opt_out,
      },
      total,
      balance: paid === null ? null : Math.max(0, total - paidAmt),
      due_date: dueDate,
      days_late: dueDate ? Math.max(0, daysBetween(dueDate, today)) : 0,
      pending_units: pendingUnits(invLines),
      items: buildItemsList(invLines, { language: lang, pendingOnly: !!dueDate }),
      template_key: key,
      language: lang,
      body,
      link,
      last_message: last ? { template_key: last.template_key, created_at: last.createdAt, status: last.status } : null,
      warnings: buildWarnings({ number, optedOut: !!customer?.whatsapp_opt_out, balance: total - paidAmt, key, recent: isRecent(last, key, now), link }),
    };
  };

  const sections = { overdue_returns: [], returns_due_today: [], returns_due_tomorrow: [], payments_pending: [] };
  for (const row of returnRows) {
    const due = toDateStr(row.due_date);
    if (!due) continue;
    // an order can owe money as well — the return message is what is actionable today
    if (due < today) sections.overdue_returns.push(buildItem(row, "overdue_return", { dueDate: due, paid: null }));
    else if (due === today) sections.returns_due_today.push(buildItem(row, "return_due_today", { dueDate: due, paid: null }));
    else sections.returns_due_tomorrow.push(buildItem(row, "return_due_tomorrow", { dueDate: due, paid: null }));
  }
  // most overdue first
  sections.overdue_returns.sort((a, b) => b.days_late - a.days_late || a.invoice_id - b.invoice_id);
  for (const row of paymentRows) {
    sections.payments_pending.push(buildItem(row, "payment_reminder", { paid: Number(row.total_paid || 0) }));
  }

  return {
    generated_at: now.toISOString(),
    today,
    truncated,
    summary: {
      overdue_returns: sections.overdue_returns.length,
      returns_due_today: sections.returns_due_today.length,
      returns_due_tomorrow: sections.returns_due_tomorrow.length,
      payments_pending: sections.payments_pending.length,
      balance_pending: sections.payments_pending.reduce((s, r) => s + r.balance, 0),
    },
    sections,
  };
};
