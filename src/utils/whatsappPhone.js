// Phone handling for WhatsApp click-to-chat links (https://wa.me/<digits>?text=…).
//
// wa.me wants the number in international format as digits only: no "+", no leading zeros,
// no spaces/dashes/brackets. Customers' numbers are typed by hand in every shape, so
// everything is normalised here, with Sri Lanka (94) as the default country.

const SL = "94";
// Sri Lankan mobiles are 07X XXX XXXX → after the country code: 7 + 8 digits.
const isSlMobileNational = (nine) => /^7[0-9]\d{7}$/.test(nine);

const digitsOnly = (s) => String(s).replace(/\D/g, "");

/**
 * @returns {{ digits: string, display: string, kind: 'mobile'|'landline'|'international'|'invalid', valid: boolean }}
 *   `valid` = this number can receive a WhatsApp message (mobile or plausible international).
 *   Landlines come back with their digits but `valid: false`.
 */
export const normalizePhone = (raw) => {
  const invalid = { digits: "", display: raw ? String(raw).trim() : "", kind: "invalid", valid: false };
  if (raw === null || raw === undefined) return invalid;
  const text = String(raw).trim();
  if (!text) return invalid;

  let digits = digitsOnly(text);
  if (!digits) return invalid;

  const hasPlus = text.startsWith("+");
  if (!hasPlus && digits.startsWith("00")) digits = digits.slice(2); // 0094… → 94…
  const international = hasPlus || text.replace(/\D/g, "").startsWith("00");

  // ── Sri Lanka ──
  let sl = null;
  if (digits.startsWith(SL) && digits.length === 11) sl = digits.slice(2); // 94 + 9
  else if (!international && digits.startsWith("0") && digits.length === 10) sl = digits.slice(1); // 0 + 9
  else if (!international && digits.length === 9) sl = digits; // typed without the leading 0
  // "+94 (0) 77 …" — a stray trunk zero after the country code
  else if (digits.startsWith(`${SL}0`) && digits.length === 12) sl = digits.slice(3);

  if (sl) {
    const e164 = `${SL}${sl}`;
    if (isSlMobileNational(sl)) {
      return { digits: e164, display: `+94 ${sl.slice(0, 2)} ${sl.slice(2, 5)} ${sl.slice(5)}`, kind: "mobile", valid: true };
    }
    // landline / other fixed number: cannot have WhatsApp
    return { digits: e164, display: `+94 ${sl.slice(0, 2)} ${sl.slice(2, 5)} ${sl.slice(5)}`, kind: "landline", valid: false };
  }

  // ── Anywhere else: trust an explicit international number of plausible length (E.164: ≤ 15) ──
  if (international && digits.length >= 8 && digits.length <= 15) {
    return { digits, display: `+${digits}`, kind: "international", valid: true };
  }
  return invalid;
};

/**
 * A customer's phone field often holds several numbers ("0771234567 / 011 2345678").
 * Returns the first number that can take WhatsApp; otherwise the first parseable one
 * (so the UI can say *why* there is no usable number); otherwise an invalid result.
 */
export const pickWhatsAppNumber = (raw) => {
  if (raw === null || raw === undefined) return normalizePhone(null);
  const parts = String(raw)
    .split(/[\/,;|\n]+|\s+(?:and|or)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const parsed = (parts.length ? parts : [String(raw)]).map(normalizePhone);
  return parsed.find((p) => p.valid) || parsed.find((p) => p.digits) || parsed[0] || normalizePhone(null);
};

/** Click-to-chat link. With no number WhatsApp opens its contact picker with the text filled in. */
export const buildWaLink = (digits, text = "") => {
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits || ""}${q}`;
};
