// migrations/tenant/20261101140000-rental-days-in-subtotal.js
//
// Days out on a line with no return date are the rental itself, not a late fee. They used to be
// billed at the handover into the line and the invoice total but not the subtotal, so the bill and
// the side panel showed them as "late fees" on top of a 1-day subtotal.
//  • INVOICES.accrued_rental — the rental part of the running charges (the rest are late fees)
//  • data fix: each invoice's sub_total becomes the rental of its lines: the whole line for lines
//    with no return date; up to the agreed days for lines with a due date (anything above that is a
//    late fee and stays outside the subtotal). total_amount is not touched.
// Idempotent: recomputing gives the same subtotal.

import { DataTypes } from "sequelize";

const DAY_MS = 24 * 60 * 60 * 1000;
const ymd = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};
const isOpenEnded = (l) => {
  const tracked = !(l.track_overdue === false || l.track_overdue === 0 || l.track_overdue === "0");
  return !tracked && ymd(l.borrow_date) !== null && ymd(l.borrow_date) === ymd(l.expected_return_date);
};
/** The dispatch price for the agreed days (same formula as createDispatchInvoice). */
const agreedCost = (l) => {
  const start = new Date(ymd(l.borrow_date)).getTime();
  const end = new Date(ymd(l.expected_return_date)).getTime();
  let days = Math.ceil((end - start) / DAY_MS);
  if (!(days >= 1)) days = 1;
  const base = Number(l.locked_base_price) || 0;
  const extra = Number(l.locked_extra_daily_rate) || 0;
  const min = Number(l.locked_minimum_days) || 1;
  const qty = Number(l.borrow_quantity) || 0;
  return days <= min ? base * qty : (base + (days - min) * extra) * qty;
};
export const rentalPart = (l) => {
  const total = Number(l.line_total_amount) || 0;
  return isOpenEnded(l) ? total : Math.min(total, agreedCost(l));
};

export const up = async ({ context: qi }) => {
  const cols = await qi.describeTable("INVOICES");
  if (!cols.accrued_rental) {
    await qi.addColumn("INVOICES", "accrued_rental", { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
  }

  const sequelize = qi.sequelize;
  // Only invoices with a no-return-date line can have rental days billed outside the subtotal.
  const [invoiceRows] = await sequelize.query(`
    SELECT DISTINCT i.invoice_id, i.sub_total
      FROM INVOICES i
      JOIN INVOICE_LINES l ON l.invoice_id = i.invoice_id
     WHERE l.track_overdue = 0 AND l.expected_return_date = l.borrow_date`);
  for (const inv of invoiceRows) {
    const [lines] = await sequelize.query(
      `SELECT borrow_date, expected_return_date, track_overdue, line_total_amount, locked_base_price,
              locked_extra_daily_rate, locked_minimum_days, borrow_quantity
         FROM INVOICE_LINES WHERE invoice_id = ?`,
      { replacements: [inv.invoice_id] },
    );
    const sub = Math.round(lines.reduce((s, l) => s + rentalPart(l), 0) * 100) / 100;
    if (Math.abs(sub - Number(inv.sub_total || 0)) >= 0.005) {
      await sequelize.query("UPDATE INVOICES SET sub_total = ? WHERE invoice_id = ?", { replacements: [sub, inv.invoice_id] });
    }
  }
};

export const down = async ({ context: qi }) => {
  const cols = await qi.describeTable("INVOICES");
  if (cols.accrued_rental) await qi.removeColumn("INVOICES", "accrued_rental");
};
