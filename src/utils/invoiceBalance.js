/**
 * Single source of truth for "how much does a customer still owe on an invoice" in raw SQL.
 *
 *   owed = live total − net payments (positive payments − refunds, voided payments excluded)
 *   live total = invoice.total_amount (billed) + invoice.accrued_charges (extra / late days so far for
 *                machines still out, kept current by services/accrualService.js)
 *
 * `advance_paid` is deliberately NOT part of the formula: creating an invoice with an advance already
 * inserts a PAYMENTS row for it, so subtracting both counted the advance twice.
 *
 * An invoice is "open" (can owe money) while it is Active (items still out) or PendingPayment
 * (everything returned but not fully paid).
 */
export const OPEN_INVOICE_STATUSES_SQL = "('Active', 'PendingPayment')";

/** Sub-select of net paid per invoice. Join it as `LEFT JOIN ${PAID_PER_INVOICE_SQL} p ON p.invoice_id = i.invoice_id`. */
export const PAID_PER_INVOICE_SQL = `(
      SELECT invoice_id, SUM(payment_amount) AS total_paid
      FROM PAYMENTS
      WHERE is_voided = 0
      GROUP BY invoice_id
    )`;

/** SQL expression for what an invoice comes to so far (billed + charges so far for machines still out). */
export const liveTotalExpr = (inv = "i") => `(${inv}.total_amount + COALESCE(${inv}.accrued_charges, 0))`;

/** SQL expression for a line's value so far. */
export const liveLineTotalExpr = (line = "il") => `(${line}.line_total_amount + COALESCE(${line}.accrued_charge, 0))`;

/** SQL expression for the amount still owed; `inv` is the invoices alias, `paid` the paid-column expression. */
export const owedExpr = (inv = "i", paid = "p.total_paid") => `(${liveTotalExpr(inv)} - COALESCE(${paid}, 0))`;

/**
 * Live total of an invoice in JS. Works for model instances / raw rows (billed `total_amount` plus
 * `accrued_charges`) and for API JSON, where `total_amount` is already live (`billed_total_amount` set).
 */
export const liveTotalOf = (inv) => {
  if (!inv) return 0;
  if (inv.billed_total_amount !== undefined) return Number(inv.total_amount) || 0;
  return Math.round(((Number(inv.total_amount) || 0) + (Number(inv.accrued_charges) || 0)) * 100) / 100;
};

/** Same maths in JS (for tests and non-SQL code). */
export const owedAmount = (totalAmount, payments = []) =>
  Number(totalAmount || 0) - payments.reduce((s, p) => s + Number(p.payment_amount || 0), 0);
