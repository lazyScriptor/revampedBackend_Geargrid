// dateRange.js — tenant-timezone-aware date parsing for report queries.
//
// The app stores DATETIME columns at the server's MySQL session timezone, but
// users see "today" in their tenant's local timezone (TenantConfig.timezone,
// default Asia/Colombo). Parsing "YYYY-MM-DD" with `new Date(str)` interprets
// the string as UTC midnight — for any tenant east of UTC that silently
// excludes evening transactions from same-day report filters.
//
// `parseTenantDayRange` converts inclusive YYYY-MM-DD bounds into JS Date
// objects representing local start-of-day and end-of-day in `tenantTz`.
// Implementation uses Intl.DateTimeFormat — no new dependencies.

const DEFAULT_TZ = "Asia/Colombo";

// Resolve the offset (in minutes east of UTC) for a given moment in a given
// IANA timezone. Positive for east of UTC, negative for west.
//   getTimezoneOffsetMinutes("Asia/Colombo", new Date()) → 330
//   getTimezoneOffsetMinutes("America/Los_Angeles", new Date()) → -420 (DST)
const getTimezoneOffsetMinutes = (tz, date) => {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    });
    const parts = formatter.formatToParts(date);
    const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value;
    // Examples: "GMT+05:30", "GMT-08:00", "GMT" (== UTC)
    const match = offsetPart && offsetPart.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
    if (!match) return 0;
    const sign = match[1] === "+" ? 1 : -1;
    const hours = parseInt(match[2], 10) || 0;
    const minutes = parseInt(match[3] || "0", 10) || 0;
    return sign * (hours * 60 + minutes);
  } catch {
    return 0; // unknown tz string — caller defaulted to UTC behaviour
  }
};

// Returns the YYYY-MM-DD of "now" in the given tenant timezone.
// 'en-CA' locale formats as ISO-style YYYY-MM-DD which is convenient to slice.
export const tenantTodayYmd = (tenantTz = DEFAULT_TZ) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tenantTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
};

// Returns the YYYY-MM-DD of N days before "today" in the tenant timezone.
// We do the subtraction in UTC arithmetic on the calendar parts only —
// no DST surprises since we never touch hours.
export const tenantNDaysAgoYmd = (tenantTz = DEFAULT_TZ, n = 30) => {
  const today = tenantTodayYmd(tenantTz);
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

// Parse inclusive YYYY-MM-DD bounds into Date objects positioned at local
// start-of-day and end-of-day in the tenant timezone. Use for Op.between or
// raw SQL comparisons against DATETIME columns.
//
// Fallback behaviour: if `startYmd` or `endYmd` is null/undefined, defaults to
// the last 30 days in the tenant timezone — matches the prior IIFE default.
export const parseTenantDayRange = (startYmd, endYmd, tenantTz = DEFAULT_TZ) => {
  const startStr = startYmd || tenantNDaysAgoYmd(tenantTz, 30);
  const endStr = endYmd || tenantTodayYmd(tenantTz);

  // Treat the YYYY-MM-DD strings as wall-clock dates in tenantTz, then
  // compute the UTC instant they correspond to. We anchor at UTC then shift
  // by the tz offset of that moment.
  const startUtcNoon = new Date(`${startStr}T00:00:00Z`);
  const endUtcEnd = new Date(`${endStr}T23:59:59.999Z`);

  const startOffset = getTimezoneOffsetMinutes(tenantTz, startUtcNoon);
  const endOffset = getTimezoneOffsetMinutes(tenantTz, endUtcEnd);

  return {
    start: new Date(startUtcNoon.getTime() - startOffset * 60_000),
    end: new Date(endUtcEnd.getTime() - endOffset * 60_000),
    startYmd: startStr,
    endYmd: endStr,
  };
};

// Single-day variant — used by daily cash flow.
export const parseTenantDay = (dayYmd, tenantTz = DEFAULT_TZ) => {
  const dayStr = dayYmd || tenantTodayYmd(tenantTz);
  return parseTenantDayRange(dayStr, dayStr, tenantTz);
};

// Resolve a tenant timezone from a request's auth context, with a safe
// fallback. The JWT-derived user includes `configData.timezone` per
// services/authService.js.
export const resolveTenantTz = (req) =>
  req?.user?.configData?.timezone || DEFAULT_TZ;
