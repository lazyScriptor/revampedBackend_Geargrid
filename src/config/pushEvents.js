export const PUSH_EVENTS = [
  { key: "invoice_created", group: "bills", default_enabled: true, has_amount: true },
  { key: "payment_received", group: "payments", default_enabled: true, has_amount: true },
  { key: "return_processed", group: "returns", default_enabled: true, has_amount: true },
  { key: "invoice_deleted", group: "alerts", default_enabled: true, has_amount: true },
  { key: "invoice_restored", group: "alerts", default_enabled: false, has_amount: true },
  { key: "payment_voided", group: "alerts", default_enabled: true, has_amount: true },
  { key: "contact_used", group: "alerts", default_enabled: true, has_amount: false },
  { key: "customer_blacklisted", group: "alerts", default_enabled: false, has_amount: false },
  { key: "follow_up_due", group: "alerts", default_enabled: true, has_amount: false },
  { key: "daily_summary", group: "digest", default_enabled: false, has_amount: false },
];

export const PUSH_EVENT_KEYS = PUSH_EVENTS.map((e) => e.key);

export const PUSH_EVENTS_BY_KEY = Object.fromEntries(
  PUSH_EVENTS.map((e) => [e.key, e]),
);
