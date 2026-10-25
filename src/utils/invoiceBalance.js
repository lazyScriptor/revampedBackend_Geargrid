/**
 * Single source of truth for "how much does a customer still owe on an invoice" in raw SQL.
 *
 *   owed = invoice.total_amount − net payments (positive payments − refunds, voided payments excluded)
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

/** SQL expression for the amount still owed; `inv` is the invoices alias, `paid` the paid-column expression. */
export const owedExpr = (inv = "i", paid = "p.total_paid") => `(${inv}.total_amount - COALESCE(${paid}, 0))`;

/** Same maths in JS (for tests and non-SQL code). */
export const owedAmount = (totalAmount, payments = []) =>
  Number(totalAmount || 0) - payments.reduce((s, p) => s + Number(p.payment_amount || 0), 0);
