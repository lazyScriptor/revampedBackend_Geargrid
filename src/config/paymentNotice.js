// The "please pay" notice a shop sees while it is overdue. Plain rules, no database.
//
// Overdue no longer has to mean locked at once: a shop keeps working, sees the notice, and locks when
// its timer runs out. A shop marked Overdue before timers existed has no timer and stays locked,
// exactly as it was.
export const DEFAULT_NOTICE = {
  message_en:
    "Your GearGrid subscription payment of Rs. {amount} is overdue by {days} days. Please make the payment to keep using the system without interruption. Contact GearGrid once you have paid.",
  message_si:
    "ඔබේ GearGrid දායක මුදල වන රු. {amount} ගෙවීම දින {days}ක් ප්‍රමාද වී ඇත. බාධාවකින් තොරව පද්ධතිය භාවිතා කිරීමට කරුණාකර ගෙවීම සිදු කරන්න. ගෙවූ පසු GearGrid අමතන්න.",
  grace_days: 7,
  repeat_minutes: 60,
  wait_seconds: 10,
};

const whole = (v, min, max, fallback) => {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
const text = (v, fallback) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 1000) : fallback);

/** Console defaults. `grace_days: null` means never lock by itself. */
export const normalizeNoticeDefaults = (input) => ({
  message_en: text(input?.message_en, DEFAULT_NOTICE.message_en),
  message_si: text(input?.message_si, DEFAULT_NOTICE.message_si),
  grace_days: input?.grace_days === null ? null : whole(input?.grace_days, 0, 365, DEFAULT_NOTICE.grace_days),
  repeat_minutes: whole(input?.repeat_minutes, 0, 1440, DEFAULT_NOTICE.repeat_minutes),
  wait_seconds: whole(input?.wait_seconds, 0, 120, DEFAULT_NOTICE.wait_seconds),
});

/** What to store on a shop when it goes (or stays) overdue. */
export const buildShopNotice = (input, defaults, existing, now = new Date()) => {
  const since = existing?.overdue_since ?? now.toISOString();
  let lockAt;
  if (input?.lock_at === null) lockAt = null;
  else if (input?.lock_at !== undefined) {
    const d = new Date(input.lock_at);
    lockAt = Number.isNaN(d.getTime()) ? (existing?.lock_at ?? null) : d.toISOString();
  } else if (existing?.overdue_since) lockAt = existing.lock_at ?? null;
  else lockAt = defaults.grace_days === null ? null : new Date(now.getTime() + defaults.grace_days * 86400000).toISOString();
  return {
    overdue_since: since,
    lock_at: lockAt,
    message_en: text(input?.message_en, null),
    message_si: text(input?.message_si, null),
    repeat_minutes: whole(input?.repeat_minutes, 0, 1440, null),
    wait_seconds: whole(input?.wait_seconds, 0, 120, null),
  };
};

/** Overdue and past its timer, or overdue from before timers existed. */
export const isPaymentLocked = (status, notice, now = Date.now()) => {
  if (status !== "Overdue") return false;
  if (!notice?.overdue_since) return true;
  return !!notice.lock_at && now >= new Date(notice.lock_at).getTime();
};

/** What a shop's app needs to show. Null when it isn't overdue. */
export const resolveNotice = ({ status, notice, defaults, displayName, monthlyRate, nextBillingDate }, now = Date.now()) => {
  if (status !== "Overdue") return null;
  const since = notice?.overdue_since ?? null;
  return {
    overdue_since: since,
    lock_at: notice?.lock_at ?? null,
    locked: isPaymentLocked(status, notice, now),
    days_overdue: since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 86400000)) : 0,
    shop: displayName ?? "",
    amount: Number(monthlyRate) || 0,
    due_date: nextBillingDate ?? null,
    message_en: notice?.message_en || defaults.message_en,
    message_si: notice?.message_si || defaults.message_si,
    repeat_minutes: notice?.repeat_minutes ?? defaults.repeat_minutes,
    wait_seconds: notice?.wait_seconds ?? defaults.wait_seconds,
  };
};
