export const BRIEF_FIELD_KEYS = [
  "name",
  "company",
  "rating",
  "status_warning",
  "balance_due",
  "deposit_balance",
  "id_retained",
  "active_items",
  "overdue",
  "invoice_count",
  "rental_dates",
  "last_payment",
  "last_review_comment",
  "recent_call_notes",
];

export const BRIEF_FIELD_KEY_SET = new Set(BRIEF_FIELD_KEYS);

export const LOCK_SCREEN_MODES = new Set([
  "full",
  "name_rating",
  "name_only",
  "hidden",
]);

export const AMOUNT_MODES = new Set([
  "exact",
  "rounded",
  "flag_only",
  "hidden",
]);

export const DEFAULT_BRIEF_PROFILES = [
  {
    id: "owner",
    name: "Owner",
    fields: ["*"],
    lock_screen: "name_rating",
    amounts: "exact",
  },
  {
    id: "counter",
    name: "Counter staff",
    fields: ["name", "company", "rating", "status_warning", "active_items", "overdue"],
    lock_screen: "name_only",
    amounts: "hidden",
  },
];

export const normalizeBriefProfile = (raw, fallback = DEFAULT_BRIEF_PROFILES[1]) => {
  if (!raw || typeof raw !== "object") {
    return { ...fallback, fields: [...fallback.fields] };
  }
  const id = String(raw.id || fallback.id || "custom").trim().slice(0, 64);
  const name = String(raw.name || fallback.name || id).trim().slice(0, 100);
  const rawFields = Array.isArray(raw.fields) ? raw.fields : fallback.fields;
  const fields = rawFields.includes("*")
    ? ["*"]
    : [
        ...new Set(
          rawFields
            .map((f) => String(f || "").trim())
            .filter((f) => BRIEF_FIELD_KEY_SET.has(f)),
        ),
      ];
  const lock_screen = LOCK_SCREEN_MODES.has(raw.lock_screen)
    ? raw.lock_screen
    : fallback.lock_screen || "name_only";
  const amounts = AMOUNT_MODES.has(raw.amounts)
    ? raw.amounts
    : fallback.amounts || "hidden";

  return {
    id,
    name,
    fields: fields.length > 0 ? fields : ["name"],
    lock_screen,
    amounts,
  };
};
