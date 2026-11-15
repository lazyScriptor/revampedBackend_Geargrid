export const PUSH_EVENTS = [
  { key: "invoice_created", default_enabled: true, has_amount: true },
  { key: "payment_received", default_enabled: true, has_amount: true },
  { key: "return_processed", default_enabled: true, has_amount: true },
  { key: "invoice_deleted", default_enabled: true, has_amount: true },
  { key: "invoice_restored", default_enabled: false, has_amount: true },
  { key: "payment_voided", default_enabled: true, has_amount: true },
  { key: "contact_used", default_enabled: true, has_amount: false },
  { key: "customer_blacklisted", default_enabled: false, has_amount: false },
];

export const PUSH_EVENT_KEYS = PUSH_EVENTS.map((e) => e.key);

export const PUSH_EVENTS_BY_KEY = Object.fromEntries(
  PUSH_EVENTS.map((e) => [e.key, e]),
);
