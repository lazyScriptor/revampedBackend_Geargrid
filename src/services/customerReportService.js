// customerReportService.js — aggregate customer queries for the Reports surface.
//
// Everything is computed on read with a single SQL join. The only cached
// aggregate on a customer row is Customer.rating, which is refreshed by the
// review service on every review write.

import { parseTenantDayRange } from "../utils/dateRange.js";

// All-customers report. One row per customer, with revenue / paid / balance /
// overdue figures aggregated across all of their invoices in the period.
// Overdue is summed from invoice lines still Active and past expected_return.
export const getAllCustomersReport = async (models, filters = {}) => {
  const { start, end, startYmd, endYmd } = parseTenantDayRange(
    filters.startDate,
    filters.endDate,
    filters.tenantTz,
  );

  const search = (filters.search || "").trim();
  const searchLike = search ? `%${search}%` : null;

  const rows = await models.sequelize.query(
    `SELECT
        c.customer_id,
        c.customer_type,
        c.first_name,
        c.last_name,
        c.company_name,
        c.phone_number,
        c.nic_number,
        c.status,
        c.rating,
        c.parent_customer_id,
        c.is_id_retained_currently,
        c.deposit_balance,
        COUNT(DISTINCT i.invoice_id) AS invoice_count,
        COALESCE(SUM(i.total_amount), 0) AS total_revenue,
        COALESCE(SUM(i.advance_paid), 0) + COALESCE(p_agg.total_paid, 0) AS total_paid,
        GREATEST(0,
          COALESCE(SUM(i.total_amount), 0)
          - COALESCE(SUM(i.advance_paid), 0)
          - COALESCE(p_agg.total_paid, 0)
        ) AS balance_due,
        COALESCE(od.overdue_amount, 0) AS overdue_amount,
        COALESCE(rv.avg_rating, c.rating) AS avg_rating,
        MAX(i.issued_date) AS last_rental_date
      FROM CUSTOMERS c
      LEFT JOIN INVOICES i
        ON i.customer_id = c.customer_id
       AND i.issued_date BETWEEN :rangeStart AND :rangeEnd
      LEFT JOIN (
        SELECT i.customer_id, SUM(p.payment_amount) AS total_paid
        FROM PAYMENTS p
        JOIN INVOICES i ON i.invoice_id = p.invoice_id
        WHERE p.payment_amount > 0
          AND p.payment_date BETWEEN :rangeStart AND :rangeEnd
        GROUP BY i.customer_id
      ) p_agg ON p_agg.customer_id = c.customer_id
      LEFT JOIN (
        SELECT i.customer_id,
               SUM(GREATEST(
                 DATEDIFF(CURDATE(), il.expected_return_date)
                 * il.locked_extra_daily_rate
                 * (il.borrow_quantity - il.good_returned_qty - il.defective_returned_qty),
                 0
               )) AS overdue_amount
        FROM INVOICE_LINES il
        JOIN INVOICES i ON i.invoice_id = il.invoice_id
        WHERE il.line_status = 'Active'
          AND il.actual_return_date IS NULL
          AND il.expected_return_date < CURDATE()
          AND (il.track_overdue IS NULL OR il.track_overdue = TRUE)
        GROUP BY i.customer_id
      ) od ON od.customer_id = c.customer_id
      LEFT JOIN (
        SELECT customer_id, AVG(rating) AS avg_rating
        FROM INVOICE_REVIEWS
        WHERE is_primary = TRUE AND rating IS NOT NULL
        GROUP BY customer_id
      ) rv ON rv.customer_id = c.customer_id
      WHERE c.customer_delete_status = FALSE
        ${searchLike ? `AND (
          c.first_name LIKE :search
          OR c.last_name LIKE :search
          OR c.company_name LIKE :search
          OR c.phone_number LIKE :search
          OR c.nic_number LIKE :search
        )` : ""}
      GROUP BY c.customer_id
      ORDER BY total_revenue DESC, c.customer_id DESC`,
    {
      replacements: {
        rangeStart: start,
        rangeEnd: end,
        ...(searchLike ? { search: searchLike } : {}),
      },
      type: models.sequelize.constructor.QueryTypes.SELECT,
    },
  );

  // Roster totals — useful for the page KPIs.
  const totals = rows.reduce(
    (acc, r) => {
      acc.totalRevenue += parseFloat(r.total_revenue) || 0;
      acc.totalPaid += parseFloat(r.total_paid) || 0;
      acc.totalBalance += parseFloat(r.balance_due) || 0;
      acc.totalOverdue += parseFloat(r.overdue_amount) || 0;
      acc.customerCount += 1;
      return acc;
    },
    { totalRevenue: 0, totalPaid: 0, totalBalance: 0, totalOverdue: 0, customerCount: 0 },
  );

  return {
    rows,
    totals,
    dateRange: { startDate: startYmd, endDate: endYmd },
  };
};

// Outstanding balances — only customers with balance_due > 0, age-bucketed by
// the days since their latest invoice was issued.
export const getOutstandingBalances = async (models, filters = {}) => {
  const data = await getAllCustomersReport(models, filters);
  const withBalance = data.rows.filter((r) => parseFloat(r.balance_due) > 0);

  const today = new Date();
  const buckets = {
    current: { label: "0-30 days", rows: [], total: 0 },
    thirtyToSixty: { label: "31-60 days", rows: [], total: 0 },
    sixtyToNinety: { label: "61-90 days", rows: [], total: 0 },
    overNinety: { label: "90+ days", rows: [], total: 0 },
  };

  for (const row of withBalance) {
    const last = row.last_rental_date ? new Date(row.last_rental_date) : today;
    const daysSince = Math.max(0, Math.floor((today - last) / (1000 * 60 * 60 * 24)));
    const amount = parseFloat(row.balance_due) || 0;
    const enriched = { ...row, days_since_last: daysSince };

    if (daysSince <= 30) {
      buckets.current.rows.push(enriched);
      buckets.current.total += amount;
    } else if (daysSince <= 60) {
      buckets.thirtyToSixty.rows.push(enriched);
      buckets.thirtyToSixty.total += amount;
    } else if (daysSince <= 90) {
      buckets.sixtyToNinety.rows.push(enriched);
      buckets.sixtyToNinety.total += amount;
    } else {
      buckets.overNinety.rows.push(enriched);
      buckets.overNinety.total += amount;
    }
  }

  return {
    buckets,
    rows: withBalance,
    grandTotal: withBalance.reduce((s, r) => s + (parseFloat(r.balance_due) || 0), 0),
    customerCount: withBalance.length,
    dateRange: data.dateRange,
  };
};
