import { Op, fn, col, literal } from "sequelize";
import { parseTenantDayRange, parseTenantDay, tenantNDaysAgoYmd } from "../utils/dateRange.js";

// ============================================================================
// 1. DASHBOARD KPIs + 30-DAY SPARKLINE
// ============================================================================
export const getDashboardKPIs = async (models, filters = {}) => {
  const tenantTz = filters.tenantTz;
  const { start: startDate, end: endDate, startYmd } = parseTenantDayRange(
    filters.startDate,
    filters.endDate,
    tenantTz,
  );
  // For the sparkline floor we always want the last 30 tenant-local days,
  // regardless of the requested filter range.
  const sparklineStartYmd = tenantNDaysAgoYmd(tenantTz, 30);

  // --- Total Revenue (positive payments in range) ---
  const revenueResult = await models.Payment.findOne({
    attributes: [[fn("COALESCE", fn("SUM", col("payment_amount")), 0), "total"]],
    where: {
      payment_amount: { [Op.gt]: 0 },
      payment_date: { [Op.between]: [startDate, endDate] },
    },
    raw: true,
  });
  const totalRevenue = parseFloat(revenueResult.total) || 0;

  // --- Total Expenses in range ---
  const expenseResult = await models.Expense.findOne({
    attributes: [[fn("COALESCE", fn("SUM", col("amount")), 0), "total"]],
    where: {
      date: { [Op.between]: [startDate, endDate] },
    },
    raw: true,
  });
  const totalExpenses = parseFloat(expenseResult.total) || 0;

  // --- Outstanding Debt (Active invoices with remaining balance) ---
  const outstandingQuery = await models.sequelize.query(
    `SELECT COALESCE(SUM(
      i.total_amount - i.advance_paid - COALESCE(p.paid, 0)
    ), 0) AS outstanding
    FROM INVOICES i
    LEFT JOIN (
      SELECT invoice_id, SUM(payment_amount) AS paid
      FROM PAYMENTS
      WHERE payment_amount > 0
      GROUP BY invoice_id
    ) p ON p.invoice_id = i.invoice_id
    WHERE i.status = 'Active'
      AND (i.total_amount - i.advance_paid - COALESCE(p.paid, 0)) > 0`,
    { type: models.sequelize.constructor.QueryTypes.SELECT },
  );
  const outstandingDebt = parseFloat(outstandingQuery[0]?.outstanding) || 0;

  // --- 30-Day Revenue Trend (daily totals) ---
  const revenueTrend = await models.sequelize.query(
    `SELECT DATE(payment_date) AS date, SUM(payment_amount) AS revenue
     FROM PAYMENTS
     WHERE payment_amount > 0
       AND payment_date >= :startDate
     GROUP BY DATE(payment_date)
     ORDER BY DATE(payment_date) ASC`,
    {
      replacements: { startDate: sparklineStartYmd },
      type: models.sequelize.constructor.QueryTypes.SELECT,
    },
  );

  return {
    totalRevenue,
    totalExpenses,
    netProfit: totalRevenue - totalExpenses,
    outstandingDebt,
    revenueTrend,
  };
};

// ============================================================================
// 2. PROFIT & LOSS (Income Statement)
// ============================================================================
export const getProfitAndLoss = async (models, filters = {}) => {
  const { start, end, startYmd, endYmd } = parseTenantDayRange(
    filters.startDate,
    filters.endDate,
    filters.tenantTz,
  );

  // --- Revenue: Positive payments ---
  const revenueResult = await models.Payment.findOne({
    attributes: [[fn("COALESCE", fn("SUM", col("payment_amount")), 0), "total"]],
    where: {
      payment_amount: { [Op.gt]: 0 },
      payment_date: { [Op.between]: [start, end] },
    },
    raw: true,
  });

  // --- Refunds: Negative payments ---
  const refundResult = await models.Payment.findOne({
    attributes: [[fn("COALESCE", fn("SUM", col("payment_amount")), 0), "total"]],
    where: {
      payment_amount: { [Op.lt]: 0 },
      payment_date: { [Op.between]: [start, end] },
    },
    raw: true,
  });

  // --- Expenses grouped by category ---
  const expenses = await models.Expense.findAll({
    attributes: [
      "category",
      [fn("SUM", col("amount")), "total"],
      [fn("COUNT", col("expense_id")), "count"],
    ],
    where: {
      date: { [Op.between]: [start, end] },
    },
    group: ["category"],
    raw: true,
  });

  // --- Equipment Depreciation (Linear over 60 months) ---
  const monthsInRange =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) +
    1;

  const depreciationResult = await models.Equipment.findOne({
    attributes: [
      [fn("COALESCE", fn("SUM", col("purchase_cost")), 0), "totalCost"],
    ],
    where: { purchase_cost: { [Op.gt]: 0 } },
    raw: true,
  });

  const totalPurchaseCost = parseFloat(depreciationResult.totalCost) || 0;
  const monthlyDepreciation = totalPurchaseCost / 60;
  const periodDepreciation = monthlyDepreciation * Math.min(monthsInRange, 60);

  const grossRevenue = parseFloat(revenueResult.total) || 0;
  const totalRefunds = Math.abs(parseFloat(refundResult.total) || 0);
  const netRevenue = grossRevenue - totalRefunds;
  const totalExpenses = expenses.reduce(
    (sum, e) => sum + parseFloat(e.total),
    0,
  );

  return {
    grossRevenue,
    totalRefunds,
    netRevenue,
    expenses,
    periodDepreciation: Math.round(periodDepreciation * 100) / 100,
    totalExpenses,
    netProfit: netRevenue - totalExpenses - periodDepreciation,
    dateRange: { startDate: startYmd, endDate: endYmd },
  };
};

// ============================================================================
// 3. ACCOUNTS RECEIVABLE (Aging Report)
// ============================================================================
export const getAccountsReceivable = async (models) => {
  const rows = await models.sequelize.query(
    `SELECT
      i.invoice_id,
      i.total_amount,
      i.advance_paid,
      i.issued_date,
      i.status,
      c.customer_id,
      c.first_name,
      c.last_name,
      c.company_name,
      c.customer_type,
      c.phone_number,
      COALESCE(p.total_paid, 0) AS total_paid,
      (i.total_amount - i.advance_paid - COALESCE(p.total_paid, 0)) AS outstanding,
      DATEDIFF(CURDATE(), i.issued_date) AS days_overdue
    FROM INVOICES i
    JOIN CUSTOMERS c ON c.customer_id = i.customer_id
    LEFT JOIN (
      SELECT invoice_id, SUM(CASE WHEN payment_amount > 0 THEN payment_amount ELSE 0 END) AS total_paid
      FROM PAYMENTS
      GROUP BY invoice_id
    ) p ON p.invoice_id = i.invoice_id
    WHERE i.status = 'Active'
      AND (i.total_amount - i.advance_paid - COALESCE(p.total_paid, 0)) > 0
    ORDER BY days_overdue DESC`,
    { type: models.sequelize.constructor.QueryTypes.SELECT },
  );

  // Group into aging buckets
  const buckets = {
    current: { label: "0–30 Days", rows: [], total: 0 },
    thirtyToSixty: { label: "31–60 Days", rows: [], total: 0 },
    sixtyToNinety: { label: "61–90 Days", rows: [], total: 0 },
    overNinety: { label: "90+ Days", rows: [], total: 0 },
  };

  for (const row of rows) {
    const outstanding = parseFloat(row.outstanding);
    const days = parseInt(row.days_overdue) || 0;

    if (days <= 30) {
      buckets.current.rows.push(row);
      buckets.current.total += outstanding;
    } else if (days <= 60) {
      buckets.thirtyToSixty.rows.push(row);
      buckets.thirtyToSixty.total += outstanding;
    } else if (days <= 90) {
      buckets.sixtyToNinety.rows.push(row);
      buckets.sixtyToNinety.total += outstanding;
    } else {
      buckets.overNinety.rows.push(row);
      buckets.overNinety.total += outstanding;
    }
  }

  const grandTotal = rows.reduce(
    (sum, r) => sum + parseFloat(r.outstanding),
    0,
  );

  return { buckets, grandTotal, totalInvoices: rows.length, allRows: rows };
};

// ============================================================================
// 4. EQUIPMENT UTILIZATION & ROI
// ============================================================================
export const getEquipmentUtilization = async (models, filters = {}) => {
  const { start, end } = parseTenantDayRange(
    filters.startDate,
    filters.endDate,
    filters.tenantTz,
  );

  const rows = await models.sequelize.query(
    `SELECT
      e.equipment_id,
      e.equipment_name,
      e.serial_number,
      e.purchase_cost,
      e.total_owned_qty,
      e.available_qty,
      e.rented_qty,
      e.defective_qty,
      ec.category_name,
      w.location_name AS warehouse,
      COALESCE(rev.total_revenue, 0) AS total_revenue,
      COALESCE(rent.total_days_rented, 0) AS total_days_rented
    FROM EQUIPMENT e
    LEFT JOIN EQUIPMENT_CATEGORIES ec ON ec.category_id = e.category_id
    LEFT JOIN WAREHOUSES w ON w.warehouse_id = e.warehouse_id
    LEFT JOIN (
      SELECT il.equipment_id,
             SUM(il.line_total_amount) AS total_revenue
      FROM INVOICE_LINES il
      JOIN INVOICES i ON i.invoice_id = il.invoice_id
      WHERE i.issued_date BETWEEN :startDate AND :endDate
      GROUP BY il.equipment_id
    ) rev ON rev.equipment_id = e.equipment_id
    LEFT JOIN (
      SELECT il.equipment_id,
             SUM(GREATEST(1, DATEDIFF(
               COALESCE(il.actual_return_date, il.expected_return_date),
               il.borrow_date
             )) * il.borrow_quantity) AS total_days_rented
      FROM INVOICE_LINES il
      JOIN INVOICES i ON i.invoice_id = il.invoice_id
      WHERE i.issued_date BETWEEN :startDate AND :endDate
      GROUP BY il.equipment_id
    ) rent ON rent.equipment_id = e.equipment_id
    ORDER BY total_revenue DESC`,
    {
      replacements: { startDate: start, endDate: end },
      type: models.sequelize.constructor.QueryTypes.SELECT,
    },
  );

  const totalDaysInRange = Math.max(
    1,
    Math.ceil((end - start) / (1000 * 60 * 60 * 24)),
  );

  const enriched = rows.map((row) => {
    const purchaseCost = parseFloat(row.purchase_cost) || 0;
    const totalRevenue = parseFloat(row.total_revenue) || 0;
    const totalOwnedQty = parseInt(row.total_owned_qty) || 1;
    const totalDaysRented = parseInt(row.total_days_rented) || 0;

    const maxPossibleDays = totalDaysInRange * totalOwnedQty;
    const utilizationPct =
      maxPossibleDays > 0
        ? Math.min(100, Math.round((totalDaysRented / maxPossibleDays) * 100))
        : 0;

    const roiPct =
      purchaseCost > 0
        ? Math.round(((totalRevenue - purchaseCost) / purchaseCost) * 10000) /
          100
        : null;

    return { ...row, utilizationPct, roiPct, totalDaysInRange };
  });

  return enriched;
};

// ============================================================================
// 5. DEFECT & MAINTENANCE COST ANALYSIS
// ============================================================================
export const getMaintenanceCostAnalysis = async (models, filters = {}) => {
  const { start, end } = parseTenantDayRange(
    filters.startDate,
    filters.endDate,
    filters.tenantTz,
  );

  // Defect counts by category
  const defects = await models.sequelize.query(
    `SELECT
      ec.category_name,
      ec.category_id,
      COUNT(dl.log_id) AS defect_count,
      SUM(dl.defective_quantity) AS total_defective_units,
      SUM(dl.repaired_quantity) AS total_repaired_units
    FROM DEFECT_LOGS dl
    JOIN EQUIPMENT e ON e.equipment_id = dl.equipment_id
    JOIN EQUIPMENT_CATEGORIES ec ON ec.category_id = e.category_id
    WHERE dl.reported_date BETWEEN :startDate AND :endDate
    GROUP BY ec.category_id, ec.category_name
    ORDER BY defect_count DESC`,
    {
      replacements: { startDate: start, endDate: end },
      type: models.sequelize.constructor.QueryTypes.SELECT,
    },
  );

  // Repair expenses by category association (via warehouse or general)
  const repairExpenses = await models.Expense.findAll({
    attributes: [
      [fn("SUM", col("amount")), "total_repair_cost"],
      [fn("COUNT", col("expense_id")), "expense_count"],
    ],
    where: {
      category: "Repair",
      date: { [Op.between]: [start, end] },
    },
    raw: true,
  });

  const totalRepairCost = parseFloat(repairExpenses[0]?.total_repair_cost) || 0;

  return {
    defectsByCategory: defects,
    totalRepairCost,
    repairExpenseCount: parseInt(repairExpenses[0]?.expense_count) || 0,
  };
};

// ============================================================================
// 6. DAILY CASH FLOW RECONCILIATION
// ============================================================================
export const getDailyCashFlow = async (models, filters = {}) => {
  const { start, end, startYmd: targetDate } = parseTenantDay(
    filters.date,
    filters.tenantTz,
  );

  const flows = await models.sequelize.query(
    `SELECT
      method,
      SUM(CASE WHEN payment_amount > 0 THEN payment_amount ELSE 0 END) AS income,
      SUM(CASE WHEN payment_amount < 0 THEN ABS(payment_amount) ELSE 0 END) AS refunds,
      SUM(payment_amount) AS net,
      COUNT(*) AS transaction_count
    FROM PAYMENTS
    WHERE payment_date BETWEEN :rangeStart AND :rangeEnd
    GROUP BY method
    ORDER BY net DESC`,
    {
      replacements: { rangeStart: start, rangeEnd: end },
      type: models.sequelize.constructor.QueryTypes.SELECT,
    },
  );

  const totals = flows.reduce(
    (acc, row) => {
      acc.totalIncome += parseFloat(row.income) || 0;
      acc.totalRefunds += parseFloat(row.refunds) || 0;
      acc.totalNet += parseFloat(row.net) || 0;
      acc.totalTransactions += parseInt(row.transaction_count) || 0;
      return acc;
    },
    { totalIncome: 0, totalRefunds: 0, totalNet: 0, totalTransactions: 0 },
  );

  return { date: targetDate, methods: flows, totals };
};
