/**
 * Pure maths for returns of sold items (plan §5.4), in integer cents.
 * Kept outside the retail module so the models can use it for the computed fields.
 *
 * A sold line's net is what the customer really paid for it:
 *   line_total (qty x price - line discount) - bill_discount_share.
 * The value refunded for a return is cumulative: the value of everything returned so far
 * is net x returned / sold (rounded to the cent), and a line that is fully returned has taken
 * back exactly its net. A return's value is the difference, so a line returned in several
 * steps refunds its net to the cent, whatever the rounding on the way.
 */

const toCents = (rupees) => Math.round((Number(rupees) || 0) * 100 + (Number(rupees) < 0 ? -1e-9 : 1e-9));
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

export const lineNetCents = (line) => Math.max(0, toCents(line?.line_total) - toCents(line?.bill_discount_share));

/** Value (cents) of the first `returnedBase` base units of a line. */
export const returnedValueCents = (line, returnedBase) => {
  const sold = round3(line?.base_qty);
  const back = round3(returnedBase);
  if (sold <= 0 || back <= 0) return 0;
  const net = lineNetCents(line);
  if (back >= sold) return net;
  return Math.round((net * back) / sold);
};

/** Value (cents) a return of `qtyBase` more base units refunds, given the line's returns so far. */
export const returnValueCents = (line, qtyBase) => {
  const before = round3(line?.returned_base_qty);
  const after = round3(before + round3(qtyBase));
  return returnedValueCents(line, after) - returnedValueCents(line, before);
};

/** Base units of a line that can still be returned. */
export const returnableBaseQty = (line) => {
  if (!line || line.status === "voided") return 0;
  return Math.max(0, round3(round3(line.base_qty) - round3(line.returned_base_qty)));
};

/** Same, in the unit the line was sold in. */
export const returnableQty = (line) => {
  const factor = Number(line?.unit_factor) > 0 ? Number(line.unit_factor) : 1;
  return round3(returnableBaseQty(line) / factor);
};

/** Total value (rupees) refunded so far across a bill's sold lines. */
export const returnedTotalOf = (lines = []) => {
  let cents = 0;
  for (const l of lines || []) {
    if (!l || l.status === "voided") continue;
    cents += returnedValueCents(l, l.returned_base_qty);
  }
  return cents / 100;
};
