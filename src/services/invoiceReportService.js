// invoiceReportService.js — invoice-centric reports for the Reports surface.

import { Op, QueryTypes } from "sequelize";
import { parseTenantDayRange } from "../utils/dateRange.js";

// Aging report — every active invoice with a positive balance, bucketed by
// days since the invoice's expected return on its earliest still-active line.
// Falls back to days since issued_date if no expected return is set.
export const getInvoiceAging = async (models, filters = {}) => {
  const tenantTz = filters.tenantTz;

  const rows = await models.sequelize.query(
    `SELECT
        i.invoice_id,
        i.issued_date,
        i.total_amount,
        i.advance_paid,
        c.customer_id,
        c.first_name,
        c.last_name,
        c.company_name,
        c.customer_type,
        c.phone_number,
        COALESCE(p.total_paid, 0) AS total_paid,
        (i.total_amount - i.advance_paid - COALESCE(p.total_paid, 0)) AS balance_due,
        DATEDIFF(CURDATE(), COALESCE(earliest_due.due_date, i.issued_date)) AS days_overdue
      FROM INVOICES i
      JOIN CUSTOMERS c ON c.customer_id = i.customer_id
      LEFT JOIN (
        SELECT invoice_id, SUM(CASE WHEN payment_amount > 0 THEN payment_amount ELSE 0 END) AS total_paid
        FROM PAYMENTS
        GROUP BY invoice_id
      ) p ON p.invoice_id = i.invoice_id
      LEFT JOIN (
        SELECT invoice_id, MIN(expected_return_date) AS due_date
        FROM INVOICE_LINES
        WHERE line_status = 'Active' AND actual_return_date IS NULL
        GROUP BY invoice_id
      ) earliest_due ON earliest_due.invoice_id = i.invoice_id
      WHERE i.status = 'Active'
        AND (i.total_amount - i.advance_paid - COALESCE(p.total_paid, 0)) > 0
      ORDER BY days_overdue DESC, balance_due DESC`,
    { type: QueryTypes.SELECT },
  );

  const buckets = {
    current: { label: "0-30 days", rows: [], total: 0 },
    thirtyToSixty: { label: "31-60 days", rows: [], total: 0 },
    sixtyToNinety: { label: "61-90 days", rows: [], total: 0 },
    overNinety: { label: "90+ days", rows: [], total: 0 },
  };

  for (const row of rows) {
    const days = Math.max(0, parseInt(row.days_overdue) || 0);
    const amount = parseFloat(row.balance_due) || 0;
    if (days <= 30) {
      buckets.current.rows.push(row);
      buckets.current.total += amount;
    } else if (days <= 60) {
      buckets.thirtyToSixty.rows.push(row);
      buckets.thirtyToSixty.total += amount;
    } else if (days <= 90) {
      buckets.sixtyToNinety.rows.push(row);
      buckets.sixtyToNinety.total += amount;
    } else {
      buckets.overNinety.rows.push(row);
      buckets.overNinety.total += amount;
    }
  }

  // Silence unused-var lint without removing the tenantTz threading — keeps
  // the controller interface consistent across all report endpoints.
  void tenantTz;

  return {
    buckets,
    rows,
    grandTotal: rows.reduce((s, r) => s + (parseFloat(r.balance_due) || 0), 0),
    totalInvoices: rows.length,
  };
};

// Rental history — read-only paginated invoice list with rolled-up line
// status. Same data the operational /rental-history page shows but without
// the return-settlement actions.
export const getRentalHistory = async (models, filters = {}) => {
  const { start, end, startYmd, endYmd } = parseTenantDayRange(
    filters.startDate,
    filters.endDate,
    filters.tenantTz,
  );
  const page = Math.max(1, parseInt(filters.page) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(filters.pageSize) || 25));
  const offset = (page - 1) * pageSize;

  const where = {
    issued_date: { [Op.between]: [start, end] },
  };
  if (filters.status && filters.status !== "All") {
    where.status = filters.status;
  }

  const { count, rows } = await models.Invoice.findAndCountAll({
    where,
    include: [
      {
        model: models.Customer,
        attributes: [
          "customer_id",
          "first_name",
          "last_name",
          "company_name",
          "customer_type",
          "phone_number",
        ],
      },
      {
        model: models.InvoiceLine,
        attributes: [
          "line_id",
          "expected_return_date",
          "actual_return_date",
          "line_status",
          "borrow_quantity",
          "good_returned_qty",
          "defective_returned_qty",
        ],
      },
      {
        model: models.Payment,
        attributes: ["payment_id", "payment_amount", "payment_date"],
      },
    ],
    limit: pageSize,
    offset,
    order: [["issued_date", "DESC"]],
    distinct: true,
  });

  return {
    rows,
    totalItems: count,
    page,
    pageSize,
    dateRange: { startDate: startYmd, endDate: endYmd },
  };
};
