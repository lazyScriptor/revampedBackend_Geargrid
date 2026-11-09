// Rental day maths shared by dispatch, returns and the live "charges so far" (mirrored by the
// frontend `lineCost.ts`). Date-only parts are timezone-safe; moments use the shop's time (Sri Lanka).
const DAY_MS = 24 * 60 * 60 * 1000;
const ymdParts = (v) => {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const utcDay = ([y, m, d]) => Date.UTC(y, m - 1, d);
export const wholeDaysBetween = (from, to) => {
  const a = ymdParts(from);
  const b = ymdParts(to);
  return a && b ? Math.round((utcDay(b) - utcDay(a)) / DAY_MS) : 0;
};
/** Days past the due date (0 when on time). */
export const lateDays = (expected, actual) => Math.max(0, wholeDaysBetween(expected, actual));

// ── The pricing rule (one place) ────────────────────────────────────────────────────────────────
// The base price pays for the whole minimum period (e.g. Rs. 250 for up to 5 days). Every day after
// that period costs the extra daily rate. Both are per unit. A 1-day machine is the same rule with a
// 1-day period, so "Rs. 50 a day" = base 50, period 1, extra 50.
const minDaysOf = (line) => Math.max(1, parseInt(line?.locked_minimum_days, 10) || 1);

/** Charge for `days` out: (base + days past the period × extra rate) × qty. */
export const periodCharge = ({ base, minDays, rate, days, qty }) => {
  const d = Math.max(1, Number(days) || 1);
  const extra = Math.max(0, d - Math.max(1, Number(minDays) || 1));
  return ((Number(base) || 0) + extra * (Number(rate) || 0)) * (Number(qty) || 0);
};

/** Days the dispatch price was worked out for (out date to due date, at least 1). */
export const contractDays = (line) => Math.max(1, wholeDaysBetween(line.borrow_date, line.expected_return_date));

/**
 * Chargeable late days for a line with a due date: days past the due date, but never days still
 * inside the paid minimum period. A 5-day scaffold due back tomorrow and returned on day 3 owes
 * nothing extra; returned on day 7 it owes 2 days. For 1-day machines this is plain days late.
 */
export const chargeableLateDays = (line, actual) => {
  const insidePeriod = Math.max(0, minDaysOf(line) - contractDays(line));
  return Math.max(0, lateDays(line.expected_return_date, actual) - insidePeriod);
};
/**
 * No return date was given at dispatch: the line was saved with a due date equal to the out date and
 * return tracking off. (A tracked line whose late fees were waived keeps its real due date, so it is not this.)
 */
export const isOpenEndedLine = (line) => {
  const tracked = !(line.track_overdue === false || line.track_overdue === 0 || line.track_overdue === "0");
  const due = ymdParts(line.expected_return_date);
  const out = ymdParts(line.borrow_date);
  return !tracked && !!due && !!out && due.join("-") === out.join("-");
};
const SHOP_TZ = "Asia/Colombo";
export const dayInShopTz = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: SHOP_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const clockInShopTz = (d) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: SHOP_TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);

/** The moment a line went out: the bill's time, moved to the line's out date when that is a different day. */
export const lineOutMoment = (line, issuedAt) => {
  const out = ymdParts(line.borrow_date);
  if (!out) return issuedAt ? new Date(issuedAt) : null;
  const day = `${String(out[0]).padStart(4, "0")}-${String(out[1]).padStart(2, "0")}-${String(out[2]).padStart(2, "0")}`;
  const issued = issuedAt ? new Date(issuedAt) : null;
  if (!issued || Number.isNaN(issued.getTime())) return new Date(`${day}T00:00:00+05:30`);
  return dayInShopTz(issued) === day ? issued : new Date(`${day}T${clockInShopTz(issued)}+05:30`);
};

/**
 * Rental days are elapsed time, rounded up: anything past 24 hours is the next day (29 hours = 2 days).
 * Never less than 1.
 */
export const elapsedRentalDays = (outAt, returnAt) => {
  const ms = new Date(returnAt).getTime() - new Date(outAt).getTime();
  return Number.isFinite(ms) ? Math.max(1, Math.ceil(ms / DAY_MS)) : 1;
};

/** Days charged beyond what the locked price already covers, for an open-ended line. */
export const openEndedExtraDays = (line, outAt, returnAt) =>
  Math.max(0, elapsedRentalDays(outAt, returnAt) - minDaysOf(line));

