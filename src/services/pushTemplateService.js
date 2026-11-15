import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AppError from "../utils/AppError.js";
import { PUSH_EVENTS_BY_KEY } from "../config/pushEvents.js";
import { PUSH_LANGUAGE_CODES } from "../config/pushLanguages.js";

const defaults = Object.fromEntries(PUSH_LANGUAGE_CODES.map((language) => [language, JSON.parse(readFileSync(fileURLToPath(new URL(`../config/pushTemplates/${language}.json`, import.meta.url)), "utf8"))]));
const PLACEHOLDER = /\{([a-z_]+)\}/g;
const PRIVATE_KEYS = new Set(["amount", "balance", "customer"]);

export const validateTemplate = (eventKey, template) => {
  const event = PUSH_EVENTS_BY_KEY[eventKey];
  if (!event) throw new AppError(`Unknown push event: ${eventKey}`, 400);
  for (const text of [template.title, template.body, template.title_private, template.body_private]) {
    let depth = 0;
    for (const ch of String(text || "")) {
      if (ch === "[") depth += 1;
      if (ch === "]") depth -= 1;
      if (depth < 0 || depth > 1) throw new AppError("Square brackets must be paired and not nested.", 400);
    }
    if (depth !== 0) throw new AppError("Square brackets must be paired and not nested.", 400);
  }
  const allowed = new Set(event.placeholders || []);
  for (const text of [template.title, template.body, template.title_private, template.body_private]) {
    for (const match of String(text || "").matchAll(PLACEHOLDER)) if (!allowed.has(match[1])) throw new AppError(`Unknown placeholder {${match[1]}} for ${eventKey}.`, 400);
  }
};

const interpolate = (source, vars, hidden = new Set()) => String(source || "")
  .replace(/\[([^\]]*)\]/g, (_match, segment) => {
    const names = [...segment.matchAll(PLACEHOLDER)].map((m) => m[1]);
    return names.some((name) => hidden.has(name) || vars[name] === null || vars[name] === undefined || vars[name] === "") ? "" : segment;
  })
  .replace(PLACEHOLDER, (_match, name) => hidden.has(name) ? "" : String(vars[name] ?? ""))
  .replace(/\s{2,}/g, " ").replace(/\s*·\s*(?=·|$)|^\s*·\s*/g, "").trim();

const TZ = "Asia/Colombo";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const partsInShopTz = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const out = {};
  for (const p of f.formatToParts(d)) out[p.type] = p.value;
  return { year: out.year, month: out.month, day: out.day, hour: Number(out.hour), minute: out.minute };
};

export const formatNotificationDate = (value, style = "dd MMM") => {
  const p = partsInShopTz(value);
  if (!p) return String(value ?? "");
  if (style === "yyyy-mm-dd") return `${p.year}-${p.month}-${p.day}`;
  if (style === "dd/mm") return `${p.day}/${p.month}`;
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]}`;
};

export const formatNotificationTime = (value, style = "24h") => {
  const p = partsInShopTz(value);
  if (!p) return String(value ?? "");
  if (style === "12h") {
    const h = p.hour % 12 || 12;
    return `${h}:${p.minute} ${p.hour < 12 ? "am" : "pm"}`;
  }
  return `${String(p.hour).padStart(2, "0")}:${p.minute}`;
};

export const formatNotificationAmount = (value, currency = "LKR") =>
  `${currency} ${Number(value).toLocaleString("en-LK", { maximumFractionDigits: 2 })}`;

// Dates and times may arrive as Date objects or ISO strings; anything else is shown as given.
const isDateLike = (v) => v instanceof Date || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v));

const formatVars = (vars = {}, format = {}) => {
  const out = { ...vars };
  for (const key of ["amount", "balance"]) {
    if (out[key] !== undefined && out[key] !== null && out[key] !== "" && Number.isFinite(Number(out[key]))) {
      out[key] = formatNotificationAmount(out[key], format.currency || "LKR");
    }
  }
  if (isDateLike(out.date)) out.date = formatNotificationDate(out.date, format.date);
  if (isDateLike(out.time)) out.time = formatNotificationTime(out.time, format.time);
  if (Array.isArray(out.items)) out.items = out.items.join(", ");
  return out;
};

/** Language for one recipient: the phone's own choice, the user's profile, the shop default, then English. */
export const resolveNotificationLanguage = ({ deviceLanguage = null, userLanguage = null, policy = null } = {}) => {
  const allowed = policy?.notifications?.allowed_languages?.length ? policy.notifications.allowed_languages : PUSH_LANGUAGE_CODES;
  for (const candidate of [deviceLanguage, userLanguage, policy?.notifications?.default_language, "en"]) {
    if (candidate && PUSH_LANGUAGE_CODES.includes(candidate) && (allowed.includes(candidate))) return candidate;
  }
  return "en";
};

export const renderForRecipient = async (models, eventKey, vars = {}, { language = "en", hideAmounts = false, hideCustomer = false, policy = null } = {}) => {
  const chosenLanguage = PUSH_LANGUAGE_CODES.includes(language) ? language : "en";
  const row = models?.PushTemplate?.findOne ? await models.PushTemplate.findOne({ where: { event_key: eventKey, language: chosenLanguage } }) : null;
  const base = row ? (row.toJSON ? row.toJSON() : row) : defaults[chosenLanguage]?.[eventKey] || defaults.en[eventKey];
  if (!base) throw new AppError(`No default template exists for ${eventKey}.`, 500);
  const hidden = new Set();
  if (hideAmounts) { hidden.add("amount"); hidden.add("balance"); }
  if (hideCustomer) hidden.add("customer");
  const formatted = formatVars(vars, policy?.notifications?.format);
  const title = interpolate((hideAmounts || hideCustomer) && base.title_private ? base.title_private : base.title, formatted, hidden);
  const body = interpolate((hideAmounts || hideCustomer) && base.body_private ? base.body_private : base.body, formatted, hidden);
  if (policy?.notifications?.bilingual === "append_english" && chosenLanguage !== "en") {
    const english = defaults.en[eventKey];
    return { title, body: `${body}\n${interpolate(english.body, formatted, hidden)}`.trim() };
  }
  return { title, body };
};

export const listTemplates = async (models) => {
  const rows = models?.PushTemplate?.findAll ? await models.PushTemplate.findAll() : [];
  const edited = new Map((rows || []).map((row) => { const value = row.toJSON ? row.toJSON() : row; return [`${value.event_key}:${value.language}`, value]; }));
  const templates = [];
  for (const [eventKey, event] of Object.entries(PUSH_EVENTS_BY_KEY)) for (const language of PUSH_LANGUAGE_CODES) {
    const value = edited.get(`${eventKey}:${language}`) || defaults[language]?.[eventKey];
    templates.push({ event_key: eventKey, language, title: value?.title || "", body: value?.body || "", title_private: value?.title_private || null, body_private: value?.body_private || null, edited: edited.has(`${eventKey}:${language}`), has_default: Boolean(defaults[language]?.[eventKey]) });
  }
  return { templates, languages: PUSH_LANGUAGE_CODES, events: Object.values(PUSH_EVENTS_BY_KEY).map((event) => ({ key: event.key, placeholders: event.placeholders || [] })) };
};

export const saveTemplate = async (models, eventKey, language, body, userId) => {
  if (!PUSH_LANGUAGE_CODES.includes(language)) throw new AppError("Unsupported language.", 400);
  validateTemplate(eventKey, body);
  const [row] = await models.PushTemplate.findOrCreate({ where: { event_key: eventKey, language }, defaults: { ...body, event_key: eventKey, language, updated_by: userId } });
  await row.update({ ...body, updated_by: userId });
  const value = row.toJSON ? row.toJSON() : row;
  return { template: { ...value, edited: true } };
};

export const resetTemplate = async (models, eventKey, language) => {
  if (!PUSH_EVENTS_BY_KEY[eventKey] || !PUSH_LANGUAGE_CODES.includes(language)) throw new AppError("Unknown template.", 404);
  await models.PushTemplate?.destroy?.({ where: { event_key: eventKey, language } });
  return { restored: true };
};
