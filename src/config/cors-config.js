// Mutable CORS origins — updated at runtime by the Super Admin console
// All origins are stored in PLATFORM_CONFIG in the master DB
export const corsOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://geargrid.live",
  "https://www.geargrid.live",
  "https://app.geargrid.live",
];

export const updateCorsOrigins = (origins) => {
  const arr = typeof origins === 'string' ? JSON.parse(origins) : origins;
  corsOrigins.length = 0;
  corsOrigins.push(...arr);
};
