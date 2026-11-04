// What a plan can switch on and off, and what each tier starts with. The super admin console edits
// the plans themselves (PLATFORM_CONFIG), but only code can decide what a feature key protects, so
// the list of keys lives here. A key added later simply starts at its default for stored plans.
//
// Everything not listed (invoices, partial returns, customers, machines, photos, signatures, sending
// a WhatsApp from an invoice, the dashboard) is part of the product and is never switched off.
export const TIERS = ["Basic", "Pro", "Enterprise"];

export const FEATURE_GROUPS = [
  { key: "accounting", features: [
    { key: "accounting.overview" }, { key: "accounting.invoices" }, { key: "accounting.payments" },
    { key: "accounting.expenses" }, { key: "accounting.receivables" }, { key: "accounting.journal" },
  ] },
  { key: "reports", features: [
    { key: "reports.customers" }, { key: "reports.equipment" }, { key: "reports.invoices" },
    { key: "reports.financials" }, { key: "reports.audit" },
  ] },
  { key: "operations", features: [
    { key: "maintenance" },
    // Technicians work repair tickets: without Maintenance the screen has nothing to show.
    { key: "workforce", requires: "maintenance" },
    { key: "cash_locker" },
    { key: "messages" },
  ] },
  { key: "data", features: [
    { key: "data.imports" }, { key: "data.add_machines" }, { key: "data.equipment_sheet" }, { key: "data.exports" },
  ] },
  { key: "admin", features: [{ key: "admin.roles" }] },
];

export const FEATURES = FEATURE_GROUPS.flatMap((g) => g.features);
export const FEATURE_KEYS = FEATURES.map((f) => f.key);
export const LIMIT_KEYS = ["max_equipment", "max_users", "max_locations"];

const allOn = () => Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]));

export const DEFAULT_PLANS = {
  Basic: {
    price: 5900,
    limits: { max_equipment: 200, max_users: 3, max_locations: 1 },
    features: {
      ...Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])),
      "accounting.overview": true,
      "accounting.invoices": true,
      "accounting.payments": true,
      "accounting.expenses": true,
      "reports.customers": true,
      "reports.invoices": true,
      messages: true,
    },
  },
  Pro: {
    price: 9900,
    limits: { max_equipment: null, max_users: 15, max_locations: null },
    features: allOn(),
  },
  Enterprise: {
    price: null,
    limits: { max_equipment: null, max_users: null, max_locations: null },
    features: allOn(),
  },
};

/** A feature that needs another is off whenever that one is off. */
export const applyRequires = (features) => {
  const out = { ...features };
  for (const f of FEATURES) if (f.requires && !out[f.requires]) out[f.key] = false;
  return out;
};

const cleanLimit = (v, fallback) => {
  if (v === null || v === "") return null;
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
};

/** Any stored or submitted plans, as complete plans for every tier: unknown keys are dropped. */
export const normalizePlans = (input) => {
  const out = {};
  for (const tier of TIERS) {
    const given = input?.[tier] ?? {};
    const base = DEFAULT_PLANS[tier];
    const features = {};
    for (const key of FEATURE_KEYS) features[key] = typeof given.features?.[key] === "boolean" ? given.features[key] : base.features[key];
    const limits = {};
    for (const key of LIMIT_KEYS) limits[key] = cleanLimit(given.limits?.[key], base.limits[key]);
    const price = given.price === null || given.price === "" ? null : Number(given.price);
    out[tier] = {
      price: given.price === undefined ? base.price : Number.isFinite(price) && price >= 0 ? price : base.price,
      limits,
      features: applyRequires(features),
    };
  }
  return out;
};

/** Per-shop exceptions: only real keys, and only values that say something. */
export const normalizeOverrides = (input) => {
  const features = {};
  for (const key of FEATURE_KEYS) if (typeof input?.features?.[key] === "boolean") features[key] = input.features[key];
  const limits = {};
  for (const key of LIMIT_KEYS) {
    const v = input?.limits?.[key];
    if (v === null) limits[key] = null;
    else if (v !== undefined && v !== "" && Number.isInteger(Number(v)) && Number(v) >= 1) limits[key] = Number(v);
  }
  return { features, limits };
};

/** What one shop actually gets: its tier's plan plus its own exceptions. */
export const effectivePlan = (plans, tier, overrides) => {
  const plan = plans[tier] ?? plans.Basic;
  const own = normalizeOverrides(overrides);
  return {
    tier: plans[tier] ? tier : "Basic",
    features: applyRequires({ ...plan.features, ...own.features }),
    limits: { ...plan.limits, ...own.limits },
  };
};
