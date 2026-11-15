export const PUSH_EVENTS = [
  { key: "invoice_created", group: "bills", default_enabled: true, has_amount: true, placeholders: ["invoice_no", "amount", "customer", "items_count", "items", "staff", "date", "time", "shop"] },
  { key: "payment_received", group: "payments", default_enabled: true, has_amount: true, placeholders: ["invoice_no", "amount", "balance", "customer", "staff", "date", "time", "shop"] },
  { key: "return_processed", group: "returns", default_enabled: true, has_amount: true, placeholders: ["invoice_no", "amount", "customer", "items", "staff"] },
  { key: "invoice_deleted", group: "alerts", default_enabled: true, has_amount: true, placeholders: ["invoice_no", "customer", "reason", "staff"] },
  { key: "invoice_restored", group: "alerts", default_enabled: false, has_amount: true, placeholders: ["invoice_no", "customer", "staff"] },
  { key: "payment_voided", group: "alerts", default_enabled: true, has_amount: true, placeholders: ["invoice_no", "amount", "customer", "reason", "staff"] },
  { key: "contact_used", group: "alerts", default_enabled: true, has_amount: false, placeholders: ["contact", "phone", "staff"] },
  { key: "customer_blacklisted", group: "alerts", default_enabled: false, has_amount: false, placeholders: ["customer", "reason", "staff"] },
  { key: "follow_up_due", group: "alerts", default_enabled: true, has_amount: false, placeholders: ["customer", "date", "reason"] },
  { key: "daily_summary", group: "digest", default_enabled: false, has_amount: false, placeholders: ["date", "shop"] },
];

export const PUSH_EVENT_KEYS = PUSH_EVENTS.map((e) => e.key);

export const PUSH_EVENTS_BY_KEY = Object.fromEntries(
  PUSH_EVENTS.map((e) => [e.key, e]),
);
