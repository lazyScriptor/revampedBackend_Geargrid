// Message templates for the WhatsApp hub. Every shop can override any template
// (per language) in Messages → Templates; these are the defaults they start from.
//
// Placeholders look like {{customer_name}}. A line whose placeholders are ALL empty is
// dropped (so "Call us: {{shop_phone}}" vanishes when the shop has not set a phone number).

export const LANGUAGES = ["en", "si"];

/** group: where the UI files the template. needsInvoice: composing it requires an invoice. */
export const TEMPLATE_META = {
  receipt: { group: "order", needsInvoice: true },
  payment_received: { group: "payments", needsInvoice: true },
  payment_reminder: { group: "payments", needsInvoice: true },
  return_due_tomorrow: { group: "returns", needsInvoice: true },
  return_due_today: { group: "returns", needsInvoice: true },
  overdue_return: { group: "returns", needsInvoice: true },
  thank_you: { group: "order", needsInvoice: true },
  custom: { group: "general", needsInvoice: false },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATE_META);

export const PLACEHOLDERS = [
  "customer_name",
  "shop_name",
  "shop_phone",
  "invoice_number",
  "issued_date",
  "items",
  "item_count",
  "total",
  "paid",
  "balance",
  "advance",
  "return_date",
  "days_late",
];

/** Sample values for the template editor's live preview. */
export const SAMPLE_VARS = {
  en: {
    customer_name: "Mr. Perera",
    shop_name: "Your Shop",
    shop_phone: "077 123 4567",
    invoice_number: "INV-1042",
    issued_date: "26 Oct 2026",
    items: "• 2 × Hammer Drill (EQ-0001)\n• 1 × Aluminium Step Ladder (EQ-0014)",
    item_count: "3",
    total: "Rs. 12,500",
    paid: "Rs. 5,000",
    balance: "Rs. 7,500",
    advance: "Rs. 2,000",
    return_date: "28 Oct 2026",
    days_late: "2",
  },
  si: {
    customer_name: "පෙරේරා මහතා",
    shop_name: "ඔබේ වෙළඳසැල",
    shop_phone: "077 123 4567",
    invoice_number: "INV-1042",
    issued_date: "26 Oct 2026",
    items: "• 2 × හැමර් ඩ්‍රිල් (EQ-0001)\n• 1 × ඇලුමිනියම් ඉණිමඟ (EQ-0014)",
    item_count: "3",
    total: "Rs. 12,500",
    paid: "Rs. 5,000",
    balance: "Rs. 7,500",
    advance: "Rs. 2,000",
    return_date: "28 Oct 2026",
    days_late: "2",
  },
};

export const DEFAULT_TEMPLATES = {
  receipt: {
    en: `Hello {{customer_name}},
Thank you for choosing {{shop_name}}.

Invoice {{invoice_number}} · {{issued_date}}
{{items}}

Total: {{total}}
Paid: {{paid}}
Balance: {{balance}}
Advance: {{advance}}

Call us: {{shop_phone}}`,
    si: `{{customer_name}},
{{shop_name}} තෝරාගැනීම ගැන ස්තූතියි.

ඉන්වොයිසිය {{invoice_number}} · {{issued_date}}
{{items}}

මුළු මුදල: {{total}}
ගෙවූ මුදල: {{paid}}
ඉතිරි මුදල: {{balance}}
අත්තිකාරම්: {{advance}}

අමතන්න: {{shop_phone}}`,
  },
  payment_received: {
    en: `Hello {{customer_name}}, we received your payment for invoice {{invoice_number}}. Paid so far: {{paid}}. Balance: {{balance}}. Thank you! — {{shop_name}}`,
    si: `{{customer_name}}, ඉන්වොයිසිය {{invoice_number}} සඳහා ඔබේ ගෙවීම ලැබුණා. මෙතෙක් ගෙවූ මුදල: {{paid}}. ඉතිරි මුදල: {{balance}}. ස්තූතියි! — {{shop_name}}`,
  },
  payment_reminder: {
    en: `Hello {{customer_name}},
A friendly reminder from {{shop_name}}: invoice {{invoice_number}} has a balance of {{balance}} (total {{total}}, paid {{paid}}).
Please settle it at your earliest convenience.

Call us: {{shop_phone}}
Thank you!`,
    si: `{{customer_name}},
{{shop_name}} වෙතින් කාරුණික සිහිකැඳවීමක්: ඉන්වොයිසිය {{invoice_number}} සඳහා ඉතිරි මුදල {{balance}} කි (මුළු {{total}}, ගෙවූ {{paid}}).
කරුණාකර හැකි ඉක්මනින් ගෙවීම සිදු කරන්න.

අමතන්න: {{shop_phone}}
ස්තූතියි!`,
  },
  return_due_tomorrow: {
    en: `Hello {{customer_name}}, a reminder from {{shop_name}}: the equipment on invoice {{invoice_number}} is due back tomorrow ({{return_date}}).
{{items}}
Need more time? Just message us.
Call us: {{shop_phone}}`,
    si: `{{customer_name}}, {{shop_name}} වෙතින් සිහිකැඳවීමක්: ඉන්වොයිසිය {{invoice_number}} හි උපකරණ හෙට ({{return_date}}) ආපසු භාර දිය යුතුයි.
{{items}}
තවත් කාලයක් අවශ්‍යද? අපට පණිවිඩයක් එවන්න.
අමතන්න: {{shop_phone}}`,
  },
  return_due_today: {
    en: `Hello {{customer_name}}, the equipment on invoice {{invoice_number}} is due back today ({{return_date}}).
{{items}}
Please return it by closing time, or message us if you need it longer.
— {{shop_name}} {{shop_phone}}`,
    si: `{{customer_name}}, ඉන්වොයිසිය {{invoice_number}} හි උපකරණ අද ({{return_date}}) ආපසු භාර දිය යුතුයි.
{{items}}
කරුණාකර වසන වේලාවට පෙර භාර දෙන්න, නැතිනම් තවත් කාලයක් අවශ්‍ය නම් අපට දන්වන්න.
— {{shop_name}} {{shop_phone}}`,
  },
  overdue_return: {
    en: `Hello {{customer_name}}, the equipment on invoice {{invoice_number}} was due back on {{return_date}} ({{days_late}} day(s) ago).
{{items}}
Please return it as soon as possible — late days are charged at the extra daily rate. If you have already returned it, please ignore this message.
— {{shop_name}} {{shop_phone}}`,
    si: `{{customer_name}}, ඉන්වොයිසිය {{invoice_number}} හි උපකරණ {{return_date}} දින ආපසු භාර දිය යුතු විය (දින {{days_late}}කට පෙර).
{{items}}
කරුණාකර හැකි ඉක්මනින් ආපසු භාර දෙන්න — ප්‍රමාද වූ දින සඳහා අමතර දෛනික ගාස්තුව අය කෙරේ. ඔබ දැනටමත් භාර දී ඇත්නම් මෙම පණිවිඩය නොසලකන්න.
— {{shop_name}} {{shop_phone}}`,
  },
  thank_you: {
    en: `Hello {{customer_name}}, thank you for renting with {{shop_name}}! We hope everything went well with invoice {{invoice_number}}. We would love to see you again.
{{shop_phone}}`,
    si: `{{customer_name}}, {{shop_name}} හරහා කුලියට ගැනීම ගැන ස්තූතියි! ඉන්වොයිසිය {{invoice_number}} සම්බන්ධයෙන් සියල්ල හොඳින් සිදු වූවා යැයි සිතමු. නැවත ඔබව දැකීමට බලාපොරොත්තු වෙමු.
{{shop_phone}}`,
  },
  custom: {
    en: `Hello {{customer_name}}, `,
    si: `{{customer_name}}, `,
  },
};

export const MAX_TEMPLATE_LENGTH = 1500;
const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Placeholders in `body` that the system does not know. */
export const unknownPlaceholders = (body) => {
  const bad = new Set();
  for (const m of String(body || "").matchAll(PLACEHOLDER_RE)) {
    if (!PLACEHOLDERS.includes(m[1])) bad.add(m[1]);
  }
  return [...bad];
};

const valueOf = (vars, key) => {
  const v = vars[key];
  return v === undefined || v === null ? "" : String(v);
};

/** Fill {{placeholders}}; drop lines whose placeholders all came out empty; tidy blank lines. */
export const renderTemplate = (body, vars = {}) => {
  const out = [];
  for (const line of String(body || "").split("\n")) {
    const found = [...line.matchAll(PLACEHOLDER_RE)];
    if (found.length === 0) {
      out.push(line);
      continue;
    }
    if (found.every((m) => valueOf(vars, m[1]).trim() === "")) continue; // every placeholder empty → drop the line
    out.push(line.replace(PLACEHOLDER_RE, (_, key) => valueOf(vars, key)));
  }
  return out
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};
