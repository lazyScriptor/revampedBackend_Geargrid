import AppError from "../utils/AppError.js";
import { tenantTodayYmd, tenantNDaysAgoYmd } from "../utils/dateRange.js";
import { findCustomerIdsBySearch, idsForSqlIn } from "../utils/customerSearch.js";
import {
  OPEN_INVOICE_STATUSES_SQL,
  PAID_PER_INVOICE_SQL,
  lineStillOutSql,
  liveTotalExpr,
  owedExpr,
  unitsOutExpr,
} from "../utils/invoiceBalance.js";
import { getCollectionsSettings } from "./collectionsSettingsService.js";
import { loadCustomerCallSummaries, matchesCallStateFilter } from "./callSummaryHelper.js";
import { computeSuggestedOutcome, normalizeInvoiceIds } from "./callLogService.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const resolveCollectionsDateRange = ({
  preset = "all_time",
  from = null,
  to = null,
  tenantTz = "Asia/Colombo",
  now = new Date(),
} = {}) => {
  const todayYmd = tenantTodayYmd(tenantTz, now);
  const p = String(preset || "all_time").toLowerCase();

  if (p === "all_time" && !from && !to) {
    return { preset: "all_time", hasDateFilter: false, fromYmd: null, toYmd: null, todayYmd };
  }
  if (p === "this_month") {
    return {
      preset: "this_month",
      hasDateFilter: true,
      fromYmd: `${todayYmd.slice(0, 7)}-01`,
      toYmd: todayYmd,
      todayYmd,
    };
  }
  if (p === "last_3_months") {
    return {
      preset: "last_3_months",
      hasDateFilter: true,
      fromYmd: tenantNDaysAgoYmd(90, tenantTz, now),
      toYmd: todayYmd,
      todayYmd,
    };
  }
  if (p === "this_year") {
    return {
      preset: "this_year",
      hasDateFilter: true,
      fromYmd: `${todayYmd.slice(0, 4)}-01-01`,
      toYmd: todayYmd,
      todayYmd,
    };
  }
  if (p === "today") {
    return {
      preset: "today",
      hasDateFilter: true,
      fromYmd: todayYmd,
      toYmd: todayYmd,
      todayYmd,
    };
  }

  // Custom or explicit from/to
  const fromYmd = from && /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? String(from) : null;
  const toYmd = to && /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? String(to) : null;
  if (!fromYmd && !toYmd) {
    return { preset: "all_time", hasDateFilter: false, fromYmd: null, toYmd: null, todayYmd };
  }
  return {
    preset: "custom",
    hasDateFilter: true,
    fromYmd: fromYmd || "1970-01-01",
    toYmd: toYmd || todayYmd,
    todayYmd,
  };
};

const parseOptionsList = (rawOptions) => {
  const list = Array.isArray(rawOptions)
    ? rawOptions
    : typeof rawOptions === "string"
      ? rawOptions
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const valid = new Set(["owes_money", "not_returned", "late", "everyone"]);
  return [...new Set(list.filter((o) => valid.has(o)))];
};

const formatCustomerName = (r) =>
  r.customer_type === "Business" && r.company_name
    ? String(r.company_name).trim()
    : `${r.first_name || ""} ${r.last_name || ""}`.trim();

const isLateCustomer = (row) =>
  row.overdue.units_out > 0 || row._late_money_returned > 0.009;

const compareValues = (a, b, dir = "desc") => {
  const mult = dir === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * mult;
  }
  return String(a).localeCompare(String(b)) * mult;
};

const getSortValue = (row, sortBy) => {
  switch (sortBy) {
    case "name":
      return row.name.toLowerCase();
    case "customer_id":
      return row.customer_id;
    case "revenue":
      return row.revenue;
    case "paid":
      return row.paid;
    case "balance":
      return row.balance;
    case "units_out":
      return row.units_out;
    case "overdue_days":
    case "overdue":
      return row.overdue.longest_days;
    case "overdue_amount":
      return row.overdue.late_money;
    case "rating":
      return row.rating ?? 0;
    case "last_bill_date":
      return row.last_bill_date;
    case "oldest_unpaid_bill":
      return row.oldest_unpaid_bill;
    case "oldest_due_date":
      return row.oldest_due_date;
    case "last_payment":
    case "last_payment_date":
      return row.last_payment_date;
    case "last_call":
    case "last_call_at":
      return row.last_call?.started_at || null;
    default:
      return row.balance;
  }
};

/**
 * GET /api/reports/customers/collections
 */
export const getCollectionsReport = async (models, query = {}) => {
  const selectType = models.sequelize?.constructor?.QueryTypes?.SELECT || "SELECT";
  const tenantTz = query.tenantTz || "Asia/Colombo";
  const now = query.now ? new Date(query.now) : new Date();
  const { preset, hasDateFilter, fromYmd, toYmd, todayYmd } = resolveCollectionsDateRange({
    preset: query.preset || "all_time",
    from: query.from,
    to: query.to,
    tenantTz,
    now,
  });

  const dateBasis = query.date_basis === "due_date" ? "due_date" : "bill_date";
  const options = parseOptionsList(query.options);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const sortBy = String(query.sort_by || "balance").trim();
  const sortDir = String(query.sort_dir || "desc").toLowerCase() === "asc" ? "asc" : "desc";

  let overdueMoneyDays = 30;
  try {
    const settings = await getCollectionsSettings(models);
    overdueMoneyDays = settings?.collections?.overdueMoneyDays ?? 30;
  } catch {
    overdueMoneyDays = 30;
  }

  const search = (query.search || "").trim();
  const searchIds = search ? idsForSqlIn(await findCustomerIdsBySearch(models, search)) : null;

  const dateJoinClause = hasDateFilter
    ? dateBasis === "due_date"
      ? `AND EXISTS (
          SELECT 1 FROM INVOICE_LINES il_d
          WHERE il_d.invoice_id = i.invoice_id
            AND DATE(il_d.expected_return_date) BETWEEN :fromYmd AND :toYmd
        )`
      : `AND DATE(i.issued_date) BETWEEN :fromYmd AND :toYmd`
    : "";

  const rawRows = await models.sequelize.query(
    `SELECT
      c.customer_id,
      c.customer_type,
      c.first_name,
      c.last_name,
      c.company_name,
      c.phone_number,
      c.nic_number,
      c.status,
      COALESCE(rv.avg_rating, c.rating) AS rating,
      COUNT(DISTINCT i.invoice_id) AS invoice_count,
      SUM(CASE WHEN i.status IN ${OPEN_INVOICE_STATUSES_SQL} THEN 1 ELSE 0 END) AS not_complete_count,
      SUM(CASE WHEN i.status = 'Completed' THEN 1 ELSE 0 END) AS complete_count,
      COALESCE(SUM(${liveTotalExpr("i")}), 0) AS revenue,
      COALESCE(SUM(COALESCE(p.total_paid, 0)), 0) AS paid,
      COALESCE(SUM(GREATEST(0, ${owedExpr("i", "p.total_paid")})), 0) AS balance,
      COALESCE(SUM(COALESCE(la.units_out, 0)), 0) AS units_out,
      COALESCE(SUM(COALESCE(la.overdue_units_out, 0)), 0) AS overdue_units_out,
      COALESCE(MAX(COALESCE(la.max_days_overdue, 0)), 0) AS longest_overdue_days,
      COALESCE(SUM(COALESCE(la.overdue_accrued, 0)), 0) AS overdue_accrued_money,
      COALESCE(SUM(
        CASE
          WHEN COALESCE(la.units_out, 0) = 0
            AND i.status IN ${OPEN_INVOICE_STATUSES_SQL}
            AND ${owedExpr("i", "p.total_paid")} > 0.009
            AND DATEDIFF(:todayYmd, COALESCE(DATE(la.last_return_date), DATE(i.issued_date))) > :overdueMoneyDays
          THEN GREATEST(0, ${owedExpr("i", "p.total_paid")})
          ELSE 0
        END
      ), 0) AS late_money_returned,
      DATE_FORMAT(MAX(i.issued_date), '%Y-%m-%d') AS last_bill_date,
      DATE_FORMAT(MIN(
        CASE
          WHEN ${owedExpr("i", "p.total_paid")} > 0.009
          THEN i.issued_date
          ELSE NULL
        END
      ), '%Y-%m-%d') AS oldest_unpaid_bill,
      DATE_FORMAT(MIN(la.earliest_due_date), '%Y-%m-%d') AS oldest_due_date,
      DATE_FORMAT(lp.last_payment_date, '%Y-%m-%d') AS last_payment_date
    FROM CUSTOMERS c
    JOIN INVOICES i
      ON i.customer_id = c.customer_id
     AND i.is_deleted = 0
     ${dateJoinClause}
    LEFT JOIN ${PAID_PER_INVOICE_SQL} p ON p.invoice_id = i.invoice_id
    LEFT JOIN (
      SELECT
        il.invoice_id,
        SUM(${unitsOutExpr("il")}) AS units_out,
        SUM(
          CASE
            WHEN ${lineStillOutSql("il")}
              AND (il.track_overdue IS NULL OR il.track_overdue = TRUE)
              AND il.expected_return_date IS NOT NULL
              AND DATE(il.expected_return_date) < :todayYmd
            THEN ${unitsOutExpr("il")}
            ELSE 0
          END
        ) AS overdue_units_out,
        MAX(
          CASE
            WHEN ${lineStillOutSql("il")}
              AND (il.track_overdue IS NULL OR il.track_overdue = TRUE)
              AND il.expected_return_date IS NOT NULL
              AND DATE(il.expected_return_date) < :todayYmd
            THEN DATEDIFF(:todayYmd, DATE(il.expected_return_date))
            ELSE 0
          END
        ) AS max_days_overdue,
        SUM(
          CASE
            WHEN ${lineStillOutSql("il")}
              AND (il.track_overdue IS NULL OR il.track_overdue = TRUE)
              AND il.expected_return_date IS NOT NULL
              AND DATE(il.expected_return_date) < :todayYmd
            THEN COALESCE(il.accrued_charge, 0)
            ELSE 0
          END
        ) AS overdue_accrued,
        MIN(
          CASE
            WHEN ${lineStillOutSql("il")}
            THEN il.expected_return_date
            ELSE NULL
          END
        ) AS earliest_due_date,
        MAX(il.actual_return_date) AS last_return_date
      FROM INVOICE_LINES il
      GROUP BY il.invoice_id
    ) la ON la.invoice_id = i.invoice_id
    LEFT JOIN (
      SELECT i2.customer_id, MAX(p2.payment_date) AS last_payment_date
      FROM PAYMENTS p2
      JOIN INVOICES i2 ON i2.invoice_id = p2.invoice_id AND i2.is_deleted = 0
      WHERE p2.is_voided = 0 AND p2.payment_amount > 0
      GROUP BY i2.customer_id
    ) lp ON lp.customer_id = c.customer_id
    LEFT JOIN (
      SELECT customer_id, AVG(rating) AS avg_rating
      FROM INVOICE_REVIEWS
      WHERE is_primary = TRUE AND rating IS NOT NULL
      GROUP BY customer_id
    ) rv ON rv.customer_id = c.customer_id
    WHERE c.customer_delete_status = FALSE
      ${searchIds ? "AND c.customer_id IN (:searchIds)" : ""}
    GROUP BY c.customer_id`,
    {
      replacements: {
        todayYmd,
        overdueMoneyDays,
        ...(hasDateFilter ? { fromYmd, toYmd } : {}),
        ...(searchIds ? { searchIds } : {}),
      },
      type: selectType,
    },
  );

  const allCustomerRows = (rawRows || []).map((r) => {
    const balance = round2(Number(r.balance) || 0);
    const revenue = round2(Number(r.revenue) || 0);
    const paid = round2(Number(r.paid) || 0);
    const unitsOut = parseInt(r.units_out, 10) || 0;
    const overdueUnitsOut = parseInt(r.overdue_units_out, 10) || 0;
    const longestDays = Math.max(0, parseInt(r.longest_overdue_days, 10) || 0);
    const overdueAccrued = round2(Number(r.overdue_accrued_money) || 0);
    const lateMoneyReturned = round2(Number(r.late_money_returned) || 0);
    const lateMoney = round2(overdueAccrued + lateMoneyReturned);
    const isBlacklisted = String(r.status || "") === "Blacklisted";

    return {
      customer_id: Number(r.customer_id),
      name: formatCustomerName(r),
      customer_type: r.customer_type || "Individual",
      nic_number: r.nic_number || null,
      phone_number: r.phone_number || null,
      status: r.status || "Active",
      is_blacklisted: isBlacklisted,
      rating: r.rating !== null && r.rating !== undefined ? round2(Number(r.rating)) : null,
      invoice_count: parseInt(r.invoice_count, 10) || 0,
      not_complete_count: parseInt(r.not_complete_count, 10) || 0,
      complete_count: parseInt(r.complete_count, 10) || 0,
      revenue,
      paid,
      balance,
      units_out: unitsOut,
      overdue: {
        units_out: overdueUnitsOut,
        longest_days: longestDays,
        late_money: lateMoney,
      },
      _late_money_returned: lateMoneyReturned,
      last_bill_date: r.last_bill_date || null,
      oldest_unpaid_bill: r.oldest_unpaid_bill || null,
      oldest_due_date: r.oldest_due_date || null,
      last_payment_date: r.last_payment_date || null,
      last_call: null,
      machines_out: [],
    };
  });

  // Live counts for the 4 option cards (for the current date range & search)
  const optionCounts = {
    owes_money: allCustomerRows.filter((r) => r.balance > 0.009).length,
    not_returned: allCustomerRows.filter((r) => r.units_out > 0).length,
    late: allCustomerRows.filter((r) => isLateCustomer(r)).length,
    everyone: allCustomerRows.length,
  };

  const callSummaryMap = await loadCustomerCallSummaries(
    models,
    allCustomerRows.map((r) => r.customer_id),
    { now, tenantTz },
  );

  for (const row of allCustomerRows) {
    const summaryObj = callSummaryMap.get(row.customer_id) || null;
    if (summaryObj) {
      const { _called_today, ...cleanSummary } = summaryObj;
      row.last_call = cleanSummary;
    }
  }

  // Apply option cards (combinable AND) + chip filters
  const activeOptions = options.filter((o) => o !== "everyone");
  const billStatus = query.bill_status ? String(query.bill_status).toLowerCase() : "all";
  const machineStatus = query.machine_status ? String(query.machine_status).toLowerCase() : "all";
  const overdueOnly =
    query.overdue_only === true || query.overdue_only === "true" || query.overdue_only === "1";
  const blacklistedOnly =
    query.blacklisted === true || query.blacklisted === "true" || query.blacklisted === "1";
  const balanceMin =
    query.balance_min !== undefined && query.balance_min !== null && query.balance_min !== ""
      ? Number(query.balance_min)
      : null;
  const ratingFilter =
    query.rating !== undefined && query.rating !== null && query.rating !== ""
      ? Number(query.rating)
      : null;
  const callState = query.call_state ? String(query.call_state).trim() : null;

  const filtered = allCustomerRows.filter((row) => {
    for (const opt of activeOptions) {
      if (opt === "owes_money" && !(row.balance > 0.009)) return false;
      if (opt === "not_returned" && !(row.units_out > 0)) return false;
      if (opt === "late" && !isLateCustomer(row)) return false;
    }
    if (billStatus === "complete" && !(row.complete_count > 0 && row.not_complete_count === 0)) {
      return false;
    }
    if (billStatus === "not_complete" && !(row.not_complete_count > 0)) {
      return false;
    }
    if (machineStatus === "returned" && !(row.units_out === 0)) return false;
    if (machineStatus === "not_returned" && !(row.units_out > 0)) return false;
    if (overdueOnly && !isLateCustomer(row)) return false;
    if (blacklistedOnly && !row.is_blacklisted) return false;
    if (balanceMin !== null && Number.isFinite(balanceMin) && !(row.balance >= balanceMin)) {
      return false;
    }
    if (
      ratingFilter !== null &&
      Number.isFinite(ratingFilter) &&
      Math.round(row.rating ?? 0) !== Math.round(ratingFilter)
    ) {
      return false;
    }
    if (callState) {
      const summaryObj = callSummaryMap.get(row.customer_id) || null;
      if (!matchesCallStateFilter(summaryObj, callState, { todayYmd })) return false;
    }
    return true;
  });

  // Totals across the entire filtered set
  const totals = filtered.reduce(
    (acc, r) => {
      acc.customer_count += 1;
      acc.revenue = round2(acc.revenue + r.revenue);
      acc.paid = round2(acc.paid + r.paid);
      acc.balance = round2(acc.balance + r.balance);
      acc.units_out += r.units_out;
      acc.overdue_units_out += r.overdue.units_out;
      acc.overdue_amount = round2(acc.overdue_amount + r.overdue.late_money);
      return acc;
    },
    {
      customer_count: 0,
      revenue: 0,
      paid: 0,
      balance: 0,
      units_out: 0,
      overdue_units_out: 0,
      overdue_amount: 0,
    },
  );

  // Sort
  filtered.sort(
    (a, b) =>
      compareValues(getSortValue(a, sortBy), getSortValue(b, sortBy), sortDir) ||
      b.customer_id - a.customer_id,
  );

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const offset = (page - 1) * limit;
  const pagedRows = filtered.slice(offset, offset + limit).map(({ _late_money_returned, ...r }) => r);

  // Second grouped query: machines-out chips for customers on the current page ONLY
  if (pagedRows.length > 0) {
    const pageCustomerIds = pagedRows.map((r) => r.customer_id);
    const machineRows = await models.sequelize.query(
      `SELECT
        i.customer_id,
        il.equipment_id,
        e.equipment_name AS name,
        SUM(${unitsOutExpr("il")}) AS count,
        MAX(
          CASE
            WHEN (il.track_overdue IS NULL OR il.track_overdue = TRUE)
              AND il.expected_return_date IS NOT NULL
              AND DATE(il.expected_return_date) < :todayYmd
            THEN DATEDIFF(:todayYmd, DATE(il.expected_return_date))
            ELSE 0
          END
        ) AS overdue_days,
        MAX(DATEDIFF(:todayYmd, DATE(i.issued_date))) AS out_days
      FROM INVOICE_LINES il
      JOIN INVOICES i ON i.invoice_id = il.invoice_id AND i.is_deleted = 0
      JOIN EQUIPMENT e ON e.equipment_id = il.equipment_id
      WHERE i.customer_id IN (:pageCustomerIds)
        AND ${lineStillOutSql("il")}
      GROUP BY i.customer_id, il.equipment_id, e.equipment_name
      HAVING count > 0
      ORDER BY overdue_days DESC, count DESC, e.equipment_name ASC`,
      {
        replacements: { pageCustomerIds, todayYmd },
        type: selectType,
      },
    );

    const machinesByCustomer = new Map();
    for (const m of machineRows || []) {
      const cid = Number(m.customer_id);
      if (!machinesByCustomer.has(cid)) machinesByCustomer.set(cid, []);
      const overdueDays = Math.max(0, parseInt(m.overdue_days, 10) || 0);
      const outDays = Math.max(0, parseInt(m.out_days, 10) || 0);
      machinesByCustomer.get(cid).push({
        equipment_id: Number(m.equipment_id),
        name: m.name,
        count: parseInt(m.count, 10) || 0,
        longest_days: overdueDays > 0 ? overdueDays : outDays,
        overdue_days: overdueDays,
        age_color: overdueDays > 0 ? "red" : outDays > 7 ? "amber" : "neutral",
      });
    }

    for (const row of pagedRows) {
      row.machines_out = machinesByCustomer.get(row.customer_id) || [];
    }
  }

  return {
    rows: pagedRows,
    totals,
    optionCounts,
    pagination: {
      page,
      limit,
      total: totalCount,
      totalPages,
    },
    dateRange: { preset, date_basis: dateBasis, from: fromYmd, to: toYmd },
  };
};

/**
 * GET /api/reports/customers/collections/:customerId
 */
export const getCustomerCollectionsDetail = async (models, customerId, query = {}) => {
  const cid = Number(customerId);
  if (!Number.isInteger(cid) || cid <= 0) {
    throw new AppError("Invalid customerId.", 400);
  }
  const selectType = models.sequelize?.constructor?.QueryTypes?.SELECT || "SELECT";
  const tenantTz = query.tenantTz || "Asia/Colombo";
  const now = query.now ? new Date(query.now) : new Date();
  const filtersOn =
    query.filters_on !== false && query.filters_on !== "false" && query.filters_on !== "0";

  const [customerRow] = await models.sequelize.query(
    `SELECT
      c.customer_id,
      c.customer_type,
      c.first_name,
      c.last_name,
      c.company_name,
      c.phone_number,
      c.nic_number,
      c.status,
      COALESCE(rv.avg_rating, c.rating) AS rating
    FROM CUSTOMERS c
    LEFT JOIN (
      SELECT customer_id, AVG(rating) AS avg_rating
      FROM INVOICE_REVIEWS
      WHERE is_primary = TRUE AND rating IS NOT NULL
      GROUP BY customer_id
    ) rv ON rv.customer_id = c.customer_id
    WHERE c.customer_id = :cid AND c.customer_delete_status = FALSE
    LIMIT 1`,
    { replacements: { cid }, type: selectType },
  );

  if (!customerRow) {
    throw new AppError("Customer not found.", 404);
  }

  const { preset, hasDateFilter, fromYmd, toYmd, todayYmd } = resolveCollectionsDateRange({
    preset: query.preset || "all_time",
    from: query.from,
    to: query.to,
    tenantTz,
    now,
  });
  const dateBasis = query.date_basis === "due_date" ? "due_date" : "bill_date";
  const options = parseOptionsList(query.options);
  const billStatus = query.bill_status ? String(query.bill_status).toLowerCase() : "all";
  const machineStatus = query.machine_status ? String(query.machine_status).toLowerCase() : "all";
  const overdueOnly =
    query.overdue_only === true || query.overdue_only === "true" || query.overdue_only === "1";

  let thresholdSeconds = 5;
  let overdueMoneyDays = 30;
  try {
    const settings = await getCollectionsSettings(models);
    thresholdSeconds = settings?.calls?.answeredThresholdSeconds ?? 5;
    overdueMoneyDays = settings?.collections?.overdueMoneyDays ?? 30;
  } catch {
    thresholdSeconds = 5;
  }

  // Fetch all non-deleted bills for this customer
  const rawBills = await models.sequelize.query(
    `SELECT
      i.invoice_id,
      CONCAT('#', i.invoice_id) AS invoice_number,
      DATE_FORMAT(i.issued_date, '%Y-%m-%d') AS issued_date,
      i.status,
      (i.total_amount + COALESCE(i.discount_amount, 0)) AS subtotal,
      i.discount_amount,
      i.total_amount,
      COALESCE(i.accrued_charges, 0) AS accrued_charges,
      ${liveTotalExpr("i")} AS live_total,
      COALESCE(p.total_paid, 0) AS paid,
      GREATEST(0, ${owedExpr("i", "p.total_paid")}) AS owed,
      COALESCE(la.units_out, 0) AS units_out,
      COALESCE(la.overdue_units_out, 0) AS overdue_units_out,
      COALESCE(la.max_days_overdue, 0) AS days_overdue,
      DATE_FORMAT(la.earliest_due_date, '%Y-%m-%d') AS earliest_due_date,
      DATE_FORMAT(la.last_return_date, '%Y-%m-%d') AS last_return_date
    FROM INVOICES i
    LEFT JOIN ${PAID_PER_INVOICE_SQL} p ON p.invoice_id = i.invoice_id
    LEFT JOIN (
      SELECT
        il.invoice_id,
        SUM(${unitsOutExpr("il")}) AS units_out,
        SUM(
          CASE
            WHEN ${lineStillOutSql("il")}
              AND (il.track_overdue IS NULL OR il.track_overdue = TRUE)
              AND il.expected_return_date IS NOT NULL
              AND DATE(il.expected_return_date) < :todayYmd
            THEN ${unitsOutExpr("il")}
            ELSE 0
          END
        ) AS overdue_units_out,
        MAX(
          CASE
            WHEN ${lineStillOutSql("il")}
              AND (il.track_overdue IS NULL OR il.track_overdue = TRUE)
              AND il.expected_return_date IS NOT NULL
              AND DATE(il.expected_return_date) < :todayYmd
            THEN DATEDIFF(:todayYmd, DATE(il.expected_return_date))
            ELSE 0
          END
        ) AS max_days_overdue,
        MIN(il.expected_return_date) AS earliest_due_date,
        MAX(il.actual_return_date) AS last_return_date
      FROM INVOICE_LINES il
      GROUP BY il.invoice_id
    ) la ON la.invoice_id = i.invoice_id
    WHERE i.customer_id = :cid AND i.is_deleted = 0
    ORDER BY i.issued_date DESC, i.invoice_id DESC`,
    { replacements: { cid, todayYmd }, type: selectType },
  );

  const invoiceIds = (rawBills || []).map((b) => Number(b.invoice_id));
  const linesByInvoice = new Map();
  const paymentsByInvoice = new Map();

  if (invoiceIds.length > 0) {
    const [lineRows, paymentRows] = await Promise.all([
      models.sequelize.query(
        `SELECT
          il.line_id,
          il.invoice_id,
          il.equipment_id,
          e.equipment_name AS equipment_name,
          il.borrow_quantity,
          COALESCE(il.good_returned_qty, 0) AS good_returned_qty,
          COALESCE(il.defective_returned_qty, 0) AS defective_returned_qty,
          ${unitsOutExpr("il")} AS units_out,
          il.line_status,
          DATE_FORMAT(il.expected_return_date, '%Y-%m-%d') AS expected_return_date,
          DATE_FORMAT(il.actual_return_date, '%Y-%m-%d') AS actual_return_date,
          COALESCE(il.accrued_charge, 0) AS accrued_charge,
          il.line_total_amount,
          CASE
            WHEN ${lineStillOutSql("il")}
              AND (il.track_overdue IS NULL OR il.track_overdue = TRUE)
              AND il.expected_return_date IS NOT NULL
              AND DATE(il.expected_return_date) < :todayYmd
            THEN DATEDIFF(:todayYmd, DATE(il.expected_return_date))
            ELSE 0
          END AS days_late
        FROM INVOICE_LINES il
        JOIN EQUIPMENT e ON e.equipment_id = il.equipment_id
        WHERE il.invoice_id IN (:invoiceIds)
        ORDER BY il.line_id ASC`,
        { replacements: { invoiceIds, todayYmd }, type: selectType },
      ),
      models.sequelize.query(
        `SELECT
          payment_id,
          invoice_id,
          payment_amount,
          method,
          is_advance,
          DATE_FORMAT(payment_date, '%Y-%m-%d') AS payment_date
        FROM PAYMENTS
        WHERE invoice_id IN (:invoiceIds) AND is_voided = 0
        ORDER BY payment_date DESC, payment_id DESC`,
        { replacements: { invoiceIds }, type: selectType },
      ),
    ]);

    for (const l of lineRows || []) {
      const invId = Number(l.invoice_id);
      if (!linesByInvoice.has(invId)) linesByInvoice.set(invId, []);
      linesByInvoice.get(invId).push({
        line_id: Number(l.line_id),
        equipment_id: Number(l.equipment_id),
        equipment_name: l.equipment_name,
        borrow_quantity: Number(l.borrow_quantity),
        good_returned_qty: Number(l.good_returned_qty),
        defective_returned_qty: Number(l.defective_returned_qty),
        units_out: Number(l.units_out),
        line_status: l.line_status,
        expected_return_date: l.expected_return_date || null,
        actual_return_date: l.actual_return_date || null,
        accrued_charge: round2(Number(l.accrued_charge) || 0),
        line_total_amount: round2(Number(l.line_total_amount) || 0),
        days_late: Math.max(0, parseInt(l.days_late, 10) || 0),
      });
    }

    for (const p of paymentRows || []) {
      const invId = Number(p.invoice_id);
      if (!paymentsByInvoice.has(invId)) paymentsByInvoice.set(invId, []);
      paymentsByInvoice.get(invId).push({
        payment_id: Number(p.payment_id),
        amount: round2(Number(p.payment_amount) || 0),
        method: p.method,
        is_advance: Boolean(p.is_advance),
        payment_date: p.payment_date || null,
      });
    }
  }

  const allBills = (rawBills || []).map((b) => {
    const invId = Number(b.invoice_id);
    const lines = linesByInvoice.get(invId) || [];
    const payments = paymentsByInvoice.get(invId) || [];
    const owed = round2(Number(b.owed) || 0);
    const unitsOut = parseInt(b.units_out, 10) || 0;
    const overdueUnitsOut = parseInt(b.overdue_units_out, 10) || 0;
    const isComplete = b.status === "Completed";
    const refDate = b.last_return_date || b.issued_date;
    const isLateReturnedMoney =
      !isComplete &&
      unitsOut === 0 &&
      owed > 0.009 &&
      refDate &&
      Math.floor((new Date(todayYmd) - new Date(refDate)) / 86400000) > overdueMoneyDays;

    return {
      invoice_id: invId,
      invoice_number: b.invoice_number,
      issued_date: b.issued_date,
      status: b.status,
      subtotal: round2(Number(b.subtotal) || 0),
      discount_amount: round2(Number(b.discount_amount) || 0),
      live_total: round2(Number(b.live_total) || 0),
      paid: round2(Number(b.paid) || 0),
      owed,
      accrued_charges: round2(Number(b.accrued_charges) || 0),
      units_out: unitsOut,
      overdue_units_out: overdueUnitsOut,
      days_overdue: Math.max(0, parseInt(b.days_overdue, 10) || 0),
      earliest_due_date: b.earliest_due_date || null,
      is_late: overdueUnitsOut > 0 || isLateReturnedMoney,
      lines,
      payments,
    };
  });

  const billMatchesFilter = (bill) => {
    if (!filtersOn) return true;
    if (hasDateFilter) {
      if (dateBasis === "due_date") {
        const hasLineInRange = bill.lines.some(
          (l) =>
            l.expected_return_date &&
            l.expected_return_date >= fromYmd &&
            l.expected_return_date <= toYmd,
        );
        if (!hasLineInRange) return false;
      } else {
        if (!bill.issued_date || bill.issued_date < fromYmd || bill.issued_date > toYmd) {
          return false;
        }
      }
    }
    const activeOptions = options.filter((o) => o !== "everyone");
    for (const opt of activeOptions) {
      if (opt === "owes_money" && !(bill.owed > 0.009)) return false;
      if (opt === "not_returned" && !(bill.units_out > 0)) return false;
      if (opt === "late" && !bill.is_late) return false;
    }
    if (billStatus === "complete" && bill.status !== "Completed") return false;
    if (billStatus === "not_complete" && bill.status === "Completed") return false;
    if (machineStatus === "returned" && bill.units_out !== 0) return false;
    if (machineStatus === "not_returned" && bill.units_out === 0) return false;
    if (overdueOnly && !bill.is_late) return false;
    return true;
  };

  const filteredBills = allBills.filter(billMatchesFilter);

  const sumBills = (list) =>
    list.reduce(
      (acc, b) => {
        acc.invoice_count += 1;
        acc.revenue = round2(acc.revenue + b.live_total);
        acc.paid = round2(acc.paid + b.paid);
        acc.balance = round2(acc.balance + b.owed);
        acc.units_out += b.units_out;
        return acc;
      },
      { invoice_count: 0, revenue: 0, paid: 0, balance: 0, units_out: 0 },
    );

  const bothTotals = {
    filtered: sumBills(filteredBills),
    all: sumBills(allBills),
  };

  const notCompleteBills = filteredBills.filter((b) => b.status !== "Completed");
  const completeBills = filteredBills.filter((b) => b.status === "Completed");

  const timeline = filteredBills.map((b) => ({
    invoice_id: b.invoice_id,
    invoice_number: b.invoice_number,
    issued_date: b.issued_date,
    status: b.status,
    owed: b.owed,
    units_out: b.units_out,
    state: b.status === "Completed" ? "complete" : b.owed > 0.009 ? "open_owing" : "open_paid",
  }));

  // Calls section (follows filtersOn + date range when filtersOn)
  const callDateWhere =
    filtersOn && hasDateFilter ? "AND DATE(cl.started_at) BETWEEN :fromYmd AND :toYmd" : "";

  let rawCalls = [];
  try {
    rawCalls = await models.sequelize.query(
      `SELECT
        cl.call_id,
        cl.source,
        cl.direction,
        cl.started_at,
        cl.duration_seconds,
        cl.invoice_ids AS call_invoice_ids,
        COALESCE(
          NULLIF(TRIM(CONCAT(COALESCE(au.first_name, ''), ' ', COALESCE(au.last_name, ''))), ''),
          au.username,
          NULLIF(TRIM(CONCAT(COALESCE(mu.first_name, ''), ' ', COALESCE(mu.last_name, ''))), ''),
          mu.username,
          NULLIF(TRIM(CONCAT(COALESCE(du.first_name, ''), ' ', COALESCE(du.last_name, ''))), ''),
          du.username
        ) AS staff_name,
        COALESCE(cn.created_by_user_id, cl.user_id, od.user_id) AS staff_id,
        cn.note_id,
        cn.outcome,
        cn.result,
        cn.note,
        cn.promise_amount,
        DATE_FORMAT(cn.promise_date, '%Y-%m-%d') AS promise_date,
        cn.promise_status,
        cn.promise_kept_at,
        DATE_FORMAT(cn.follow_up_on, '%Y-%m-%d') AS follow_up_on,
        cn.invoice_ids AS note_invoice_ids,
        cr.recording_id,
        cr.duration_seconds AS recording_duration_seconds,
        cr.dispute_hold
      FROM CALL_LOGS cl
      LEFT JOIN OPERATOR_DEVICES od ON od.operator_device_id = cl.operator_device_id
      LEFT JOIN USERS mu ON mu.user_id = cl.user_id
      LEFT JOIN USERS du ON du.user_id = od.user_id
      LEFT JOIN CALL_NOTES cn ON cn.note_id = (
        SELECT cn2.note_id
        FROM CALL_NOTES cn2
        WHERE cn2.call_id = cl.call_id
        ORDER BY cn2.note_id DESC
        LIMIT 1
      )
      LEFT JOIN USERS au ON au.user_id = cn.created_by_user_id
      LEFT JOIN CALL_RECORDINGS cr ON cr.call_id = cl.call_id
      WHERE cl.customer_id = :cid
        ${callDateWhere}
      ORDER BY cl.started_at DESC, cl.call_id DESC`,
      {
        replacements: {
          cid,
          ...(filtersOn && hasDateFilter ? { fromYmd, toYmd } : {}),
        },
        type: selectType,
      },
    );
  } catch {
    rawCalls = [];
  }

  const byStaffMap = new Map();
  let answeredCount = 0;
  let noAnswerCount = 0;
  let unreachableCount = 0;
  let unnotedCount = 0;
  let promisesCount = 0;
  let promiseTotal = 0;
  let promisesKept = 0;
  let promisesMissed = 0;

  const calls = (rawCalls || []).map((c) => {
    const dur =
      c.duration_seconds !== null && c.duration_seconds !== undefined
        ? Number(c.duration_seconds)
        : null;
    const suggested = computeSuggestedOutcome(dur, thresholdSeconds);
    const effectiveOutcome = c.outcome || suggested;
    if (effectiveOutcome === "answered") answeredCount += 1;
    else if (effectiveOutcome === "unreachable") unreachableCount += 1;
    else if (effectiveOutcome === "no_answer") noAnswerCount += 1;

    const hasNote = c.note_id != null;
    if (!hasNote) unnotedCount += 1;

    if (c.staff_id && c.staff_name) {
      const sid = Number(c.staff_id);
      if (!byStaffMap.has(sid)) {
        byStaffMap.set(sid, { user_id: sid, name: c.staff_name, count: 0 });
      }
      byStaffMap.get(sid).count += 1;
    }

    if (c.promise_status) {
      promisesCount += 1;
      promiseTotal = round2(promiseTotal + (Number(c.promise_amount) || 0));
      if (c.promise_status === "kept") promisesKept += 1;
      if (c.promise_status === "missed") promisesMissed += 1;
    }

    const noteInvIds = normalizeInvoiceIds(c.note_invoice_ids);
    const callInvIds = normalizeInvoiceIds(c.call_invoice_ids);
    return {
      call_id: Number(c.call_id),
      started_at: c.started_at ? new Date(c.started_at).toISOString() : null,
      source: c.source || "phone",
      direction: c.direction,
      duration_seconds: dur,
      suggested_outcome: suggested,
      staff_id: c.staff_id != null ? Number(c.staff_id) : null,
      staff_name: c.staff_name || null,
      invoice_ids: noteInvIds.length > 0 ? noteInvIds : callInvIds,
      outcome: c.outcome || null,
      result: c.result || null,
      note: c.note || null,
      has_note: hasNote,
      promise_amount:
        c.promise_amount !== null && c.promise_amount !== undefined
          ? Number(c.promise_amount)
          : null,
      promise_date: c.promise_date || null,
      promise_status: c.promise_status || null,
      promise_kept_at: c.promise_kept_at ? new Date(c.promise_kept_at).toISOString() : null,
      follow_up_on: c.follow_up_on || null,
      recording_id: c.recording_id != null ? Number(c.recording_id) : null,
      recording_duration_seconds:
        c.recording_duration_seconds !== null && c.recording_duration_seconds !== undefined
          ? Number(c.recording_duration_seconds)
          : null,
      dispute_hold: Boolean(c.dispute_hold),
    };
  });

  // Aggregate machines out across filtered bills (or all bills)
  const machineChipMap = new Map();
  for (const b of filteredBills) {
    for (const l of b.lines) {
      if (l.units_out <= 0) continue;
      if (!machineChipMap.has(l.equipment_id)) {
        machineChipMap.set(l.equipment_id, {
          equipment_id: l.equipment_id,
          name: l.equipment_name,
          count: 0,
          longest_days: 0,
        });
      }
      const entry = machineChipMap.get(l.equipment_id);
      entry.count += l.units_out;
      entry.longest_days = Math.max(entry.longest_days, l.days_late);
    }
  }

  return {
    filters_on: filtersOn,
    dateRange: { preset, date_basis: dateBasis, from: fromYmd, to: toYmd },
    customer: {
      customer_id: Number(customerRow.customer_id),
      name: formatCustomerName(customerRow),
      customer_type: customerRow.customer_type || "Individual",
      phone_number: customerRow.phone_number || null,
      nic_number: customerRow.nic_number || null,
      status: customerRow.status || "Active",
      is_blacklisted: String(customerRow.status || "") === "Blacklisted",
      rating:
        customerRow.rating !== null && customerRow.rating !== undefined
          ? round2(Number(customerRow.rating))
          : null,
      machines_out: [...machineChipMap.values()],
      ...bothTotals.filtered,
    },
    both_totals: bothTotals,
    timeline,
    not_complete_bills: notCompleteBills,
    complete_bills: completeBills,
    calls_section: {
      summary: {
        total_calls: calls.length,
        answered_count: answeredCount,
        no_answer_count: noAnswerCount,
        unreachable_count: unreachableCount,
        unnoted_count: unnotedCount,
        by_staff: [...byStaffMap.values()],
        promises_count: promisesCount,
        promise_total: promiseTotal,
        promises_kept: promisesKept,
        promises_missed: promisesMissed,
      },
      calls,
    },
  };
};

/**
 * GET /api/reports/calls
 */
export const getCallsReport = async (models, query = {}) => {
  const selectType = models.sequelize?.constructor?.QueryTypes?.SELECT || "SELECT";
  const tenantTz = query.tenantTz || "Asia/Colombo";
  const now = query.now ? new Date(query.now) : new Date();
  const { preset, hasDateFilter, fromYmd, toYmd } = resolveCollectionsDateRange({
    preset: query.preset || "today",
    from: query.from,
    to: query.to,
    tenantTz,
    now,
  });

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));

  let thresholdSeconds = 5;
  try {
    const settings = await getCollectionsSettings(models);
    thresholdSeconds = settings?.calls?.answeredThresholdSeconds ?? 5;
  } catch {
    thresholdSeconds = 5;
  }

  const whereParts = ["1=1"];
  const replacements = {};

  if (hasDateFilter) {
    whereParts.push("DATE(cl.started_at) BETWEEN :fromYmd AND :toYmd");
    replacements.fromYmd = fromYmd;
    replacements.toYmd = toYmd;
  }
  if (query.customer_id) {
    whereParts.push("cl.customer_id = :customerId");
    replacements.customerId = Number(query.customer_id);
  }
  if (query.staff_id) {
    whereParts.push("COALESCE(cn.created_by_user_id, cl.user_id, od.user_id) = :staffId");
    replacements.staffId = Number(query.staff_id);
  }
  if (query.outcome) {
    whereParts.push("cn.outcome = :outcome");
    replacements.outcome = String(query.outcome).trim();
  }
  if (query.promise_status) {
    whereParts.push("cn.promise_status = :promiseStatus");
    replacements.promiseStatus = String(query.promise_status).trim();
  }

  const rawRows = await models.sequelize.query(
    `SELECT
      cl.call_id,
      cl.customer_id,
      c.customer_type,
      c.first_name,
      c.last_name,
      c.company_name,
      cl.phone_e164,
      cl.raw_number,
      cl.source,
      cl.direction,
      cl.started_at,
      cl.duration_seconds,
      cl.invoice_ids AS call_invoice_ids,
      COALESCE(cn.created_by_user_id, cl.user_id, od.user_id) AS staff_id,
      COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(au.first_name, ''), ' ', COALESCE(au.last_name, ''))), ''),
        au.username,
        NULLIF(TRIM(CONCAT(COALESCE(mu.first_name, ''), ' ', COALESCE(mu.last_name, ''))), ''),
        mu.username,
        NULLIF(TRIM(CONCAT(COALESCE(du.first_name, ''), ' ', COALESCE(du.last_name, ''))), ''),
        du.username
      ) AS staff_name,
      cn.note_id,
      cn.outcome,
      cn.result,
      cn.note,
      cn.promise_amount,
      DATE_FORMAT(cn.promise_date, '%Y-%m-%d') AS promise_date,
      cn.promise_status,
      cn.promise_kept_at,
      cn.invoice_ids AS note_invoice_ids,
      cr.recording_id,
      cr.dispute_hold
    FROM CALL_LOGS cl
    LEFT JOIN CUSTOMERS c ON c.customer_id = cl.customer_id
    LEFT JOIN OPERATOR_DEVICES od ON od.operator_device_id = cl.operator_device_id
    LEFT JOIN USERS mu ON mu.user_id = cl.user_id
    LEFT JOIN USERS du ON du.user_id = od.user_id
    LEFT JOIN CALL_NOTES cn ON cn.note_id = (
      SELECT cn2.note_id
      FROM CALL_NOTES cn2
      WHERE cn2.call_id = cl.call_id
      ORDER BY cn2.note_id DESC
      LIMIT 1
    )
    LEFT JOIN USERS au ON au.user_id = cn.created_by_user_id
    LEFT JOIN CALL_RECORDINGS cr ON cr.call_id = cl.call_id
    WHERE ${whereParts.join(" AND ")}
    ORDER BY cl.started_at DESC, cl.call_id DESC`,
    { replacements, type: selectType },
  );

  const totals = {
    total_calls: 0,
    answered_count: 0,
    no_answer_count: 0,
    unreachable_count: 0,
    promises_count: 0,
    promise_amount_total: 0,
    promises_kept: 0,
    promises_missed: 0,
  };
  const staffMap = new Map();

  const allRows = (rawRows || []).map((r) => {
    const dur =
      r.duration_seconds !== null && r.duration_seconds !== undefined
        ? Number(r.duration_seconds)
        : null;
    const suggested = computeSuggestedOutcome(dur, thresholdSeconds);
    const effectiveOutcome = r.outcome || suggested;
    totals.total_calls += 1;
    if (effectiveOutcome === "answered") totals.answered_count += 1;
    else if (effectiveOutcome === "unreachable") totals.unreachable_count += 1;
    else if (effectiveOutcome === "no_answer") totals.no_answer_count += 1;

    const promiseAmt =
      r.promise_amount !== null && r.promise_amount !== undefined
        ? Number(r.promise_amount)
        : null;
    if (r.promise_status) {
      totals.promises_count += 1;
      totals.promise_amount_total = round2(totals.promise_amount_total + (promiseAmt || 0));
      if (r.promise_status === "kept") totals.promises_kept += 1;
      if (r.promise_status === "missed") totals.promises_missed += 1;
    }

    if (r.staff_id && r.staff_name) {
      const sid = Number(r.staff_id);
      if (!staffMap.has(sid)) {
        staffMap.set(sid, {
          user_id: sid,
          staff_name: r.staff_name,
          total_calls: 0,
          answered_count: 0,
          promises_count: 0,
          promise_amount_total: 0,
          promises_kept: 0,
        });
      }
      const st = staffMap.get(sid);
      st.total_calls += 1;
      if (effectiveOutcome === "answered") st.answered_count += 1;
      if (r.promise_status) {
        st.promises_count += 1;
        st.promise_amount_total = round2(st.promise_amount_total + (promiseAmt || 0));
        if (r.promise_status === "kept") st.promises_kept += 1;
      }
    }

    const noteInvIds = normalizeInvoiceIds(r.note_invoice_ids);
    const callInvIds = normalizeInvoiceIds(r.call_invoice_ids);
    return {
      call_id: Number(r.call_id),
      customer_id: r.customer_id != null ? Number(r.customer_id) : null,
      customer_name: r.customer_id ? formatCustomerName(r) : null,
      phone_e164: r.phone_e164 || null,
      raw_number: r.raw_number || null,
      source: r.source || "phone",
      direction: r.direction,
      started_at: r.started_at ? new Date(r.started_at).toISOString() : null,
      duration_seconds: dur,
      suggested_outcome: suggested,
      staff_id: r.staff_id != null ? Number(r.staff_id) : null,
      staff_name: r.staff_name || null,
      outcome: r.outcome || null,
      result: r.result || null,
      note: r.note || null,
      has_note: r.note_id != null,
      promise_amount: promiseAmt,
      promise_date: r.promise_date || null,
      promise_status: r.promise_status || null,
      promise_kept_at: r.promise_kept_at ? new Date(r.promise_kept_at).toISOString() : null,
      invoice_ids: noteInvIds.length > 0 ? noteInvIds : callInvIds,
      recording_id: r.recording_id != null ? Number(r.recording_id) : null,
      dispute_hold: Boolean(r.dispute_hold),
    };
  });

  const offset = (page - 1) * limit;
  return {
    rows: allRows.slice(offset, offset + limit),
    totals,
    by_staff: [...staffMap.values()],
    pagination: {
      page,
      limit,
      total: allRows.length,
      totalPages: Math.max(1, Math.ceil(allRows.length / limit)),
    },
    dateRange: { preset, from: fromYmd, to: toYmd },
  };
};
