// Mutable CORS origins — updated at runtime by the Super Admin console
// All origins are stored in PLATFORM_CONFIG in the master DB
export const parseExtraCorsOrigins = (raw = process.env.CORS_EXTRA_ORIGINS) => {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

const mergeWithExtra = (base) => {
  const seen = new Set(base);
  const out = [...base];
  for (const origin of parseExtraCorsOrigins()) {
    if (!seen.has(origin)) {
      seen.add(origin);
      out.push(origin);
    }
  }
  return out;
};

export const corsOrigins = mergeWithExtra([
  "http://localhost:5173",
  "http://localhost:5174",
  "https://geargrid.live",
  "https://www.geargrid.live",
  "https://app.geargrid.live",
]);

export const updateCorsOrigins = (origins) => {
  const arr = typeof origins === "string" ? JSON.parse(origins) : origins;
  const merged = mergeWithExtra(arr);
  corsOrigins.length = 0;
  corsOrigins.push(...merged);
};
