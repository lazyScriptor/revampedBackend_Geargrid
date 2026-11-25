import { Op, fn, col, QueryTypes } from "sequelize";
import * as reportService from "./reportService.js";
import { tenantTodayYmd, tenantNDaysAgoYmd } from "../utils/dateRange.js";
import {
  OPEN_INVOICE_STATUSES_SQL,
  PAID_PER_INVOICE_SQL,
  liveTotalExpr,
  owedExpr,
  unitsOutExpr,
  lineStillOutSql,
} from "../utils/invoiceBalance.js";
import AppError from "../utils/AppError.js";
import {
  computeCallFilterCounts,
  loadCustomerCallSummaries,
  matchesCallStateFilter,
} from "./callSummaryHelper.js";

// ============================================================================
// WIDGET CATALOG — source of truth for all available widgets (code-defined,
// not DB-stored, so no sync issues when widgets are added/removed in code).
// ============================================================================
export const WIDGET_CATALOG = [
  {
    widget_key: "revenue_kpi",
    display_name: "Revenue",
    description: "Total revenue with sparkline trend for the selected period",
    required_permission: null,
    default_w: 3, default_h: 2, min_w: 2, min_h: 2,
  },
  {
    widget_key: "net_profit_kpi",
    display_name: "Net Profit",
    description: "Net profit (revenue minus all expenses) for the selected period",
    required_permission: null,
    default_w: 3, default_h: 2, min_w: 2, min_h: 2,
  },
  {
    widget_key: "outstanding_debt_kpi",
    display_name: "Outstanding Debt",
    description: "Total unpaid invoice balances across all active rentals",
    required_permission: null,
    default_w: 3, default_h: 2, min_w: 2, min_h: 2,
  },
  {
    widget_key: "active_rentals_kpi",
    display_name: "Active Rentals",
    description: "Count of currently active rental invoices",
    required_permission: null,
    default_w: 3, default_h: 2, min_w: 2, min_h: 2,
  },
  {
    widget_key: "revenue_trend_chart",
    display_name: "Revenue Trend",
    description: "30-day daily revenue bar chart",
    required_permission: null,
    default_w: 6, default_h: 3, min_w: 4, min_h: 3,
  },
  {
    widget_key: "utilization_sparkline",
    display_name: "Fleet Utilization",
    description: "7-day equipment utilization rate sparkline",
    required_permission: "inventory_permission",
    default_w: 6, default_h: 3, min_w: 4, min_h: 3,
  },
  {
    widget_key: "returns_today",
    display_name: "Returns Due",
    description: "Rentals due back today and overdue — actionable list",
    required_permission: null,
    default_w: 6, default_h: 4, min_w: 3, min_h: 3,
  },
  {
    widget_key: "maintenance_queue",
    display_name: "Maintenance Queue",
    description: "Open defect logs requiring technician attention",
    required_permission: "inventory_permission",
    default_w: 6, default_h: 4, min_w: 3, min_h: 3,
  },
  {
    widget_key: "category_revenue",
    display_name: "Revenue by Category",
    description: "Revenue per equipment family (all Grinders, all Drills...) for the selected period",
    required_permission: "inventory_permission",
    default_w: 6, default_h: 4, min_w: 3, min_h: 3,
  },
  {
    widget_key: "top_earning_machines",
    display_name: "Top Earning Machines",
    description: "The machines that earned the most in the selected period",
    required_permission: "inventory_permission",
    default_w: 6, default_h: 4, min_w: 3, min_h: 3,
  },
  {
    widget_key: "idle_machines",
    display_name: "Idle Machines",
    description: "Machines with no rentals in the selected period, dearest first",
    required_permission: "inventory_permission",
    default_w: 6, default_h: 4, min_w: 3, min_h: 3,
  },
  {
    widget_key: "open_money",
    display_name: "Money Owed",
    description: "Open invoices with unpaid balances, aged by issue date",
    required_permission: "inventory_permission",
    default_w: 6, default_h: 4, min_w: 3, min_h: 3,
  },
  {
    widget_key: "open_returns",
    display_name: "Equipment Not Returned",
    description: "Open invoices with rental equipment still out",
    required_permission: null,
    default_w: 6, default_h: 4, min_w: 3, min_h: 3,
  },
];

export const DEFAULT_LAYOUT = [
  { i: "revenue_kpi",         x: 0, y: 0, w: 3, h: 2 },
  { i: "net_profit_kpi",      x: 3, y: 0, w: 3, h: 2 },
  { i: "outstanding_debt_kpi",x: 6, y: 0, w: 3, h: 2 },
  { i: "active_rentals_kpi",  x: 9, y: 0, w: 3, h: 2 },
  { i: "revenue_trend_chart", x: 0, y: 2, w: 6, h: 3 },
  { i: "utilization_sparkline",x: 6, y: 2, w: 6, h: 3 },
  { i: "returns_today",       x: 0, y: 5, w: 6, h: 4 },
  { i: "maintenance_queue",   x: 6, y: 5, w: 6, h: 4 },
  { i: "open_money",          x: 0, y: 9, w: 6, h: 4 },
  { i: "open_returns",        x: 6, y: 9, w: 6, h: 4 },
];

// Called per request so "today" is recomputed each time. Previously this was
// an IIFE that froze the default to the server's boot time and the server's
// UTC date — both wrong for long-lived processes and for tenants east of UTC.
const buildDefaultFilters = (tenantTz) => ({
  startDate: tenantNDaysAgoYmd(tenantTz, 30),
  endDate: tenantTodayYmd(tenantTz),
  warehouseId: null,
});

// ============================================================================
// 1. DASHBOARD CONFIG — effective layout for a user (preference > role template > default)
// ============================================================================
export const getConfig = async (models, userId, tenantTz) => {
  const defaults = buildDefaultFilters(tenantTz);
  const pref = await models.UserDashboardPreference.findOne({ where: { user_id: userId } });

  if (pref?.custom_layout_json?.length > 0) {
    return {
      layout: pref.custom_layout_json,
      savedFilters: pref.saved_filters_json || defaults,
      widgetCatalog: WIDGET_CATALOG,
      source: "user",
    };
  }

  // Fallback: find any active template for the user's roles (handled by controller passing roleId)
  return {
    layout: DEFAULT_LAYOUT,
    savedFilters: defaults,
    widgetCatalog: WIDGET_CATALOG,
    source: "default",
  };
};

export const getConfigForRole = async (models, userId, roleId, tenantTz) => {
  const defaults = buildDefaultFilters(tenantTz);
  const pref = await models.UserDashboardPreference.findOne({ where: { user_id: userId } });

  if (pref?.custom_layout_json?.length > 0) {
    return {
      layout: pref.custom_layout_json,
      savedFilters: pref.saved_filters_json || defaults,
      widgetCatalog: WIDGET_CATALOG,
      source: "user",
    };
  }

  if (roleId) {
    const template = await models.DashboardTemplate.findOne({
      where: { role_id: roleId, is_active: true },
    });
    if (template) {
      return {
        layout: template.layout_json,
        savedFilters: defaults,
        widgetCatalog: WIDGET_CATALOG,
        source: "role_template",
        template_id: template.template_id,
      };
    }
  }

  return {
    layout: DEFAULT_LAYOUT,
    savedFilters: defaults,
    widgetCatalog: WIDGET_CATALOG,
    source: "default",
  };
};

// ============================================================================
// 2. SYNC USER PREFERENCES (debounced PATCH from frontend)
// ============================================================================
export const syncPreferences = async (models, userId, { layout, filters }) => {
  // null layout is the "reset" signal — clear saved layout so getConfig falls back to DEFAULT_LAYOUT
  const [pref] = await models.UserDashboardPreference.upsert(
    {
      user_id: userId,
      custom_layout_json: layout ?? null,
      saved_filters_json: filters ?? null,
      last_synced_at: new Date(),
    },
    { returning: true },
  );
  return pref;
};

// ============================================================================
// 3. DASHBOARD KPIs (delegates to reportService + adds active rental count)
// ============================================================================
export const getKPIs = async (models, filters = {}) => {
  const baseKpis = await reportService.getDashboardKPIs(models, filters);

  const activeCount = await models.Invoice.count({ where: { status: "Active" } });

  return { ...baseKpis, activeRentalsCount: activeCount };
};

// ============================================================================
// 4. UTILIZATION SPARKLINE — 7-day fleet utilization %
// ============================================================================
export const getUtilizationSparkline = async (models, { warehouseId } = {}) => {
  const totalOwnedResult = await models.Equipment.sum("total_owned_qty", {
    where: { is_archived: false, ...(warehouseId ? { warehouse_id: warehouseId } : {}) },
  });
  const totalOwned = parseInt(totalOwnedResult) || 1;

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split("T")[0]);
  }

  const sparklineData = await Promise.all(
    days.map(async (day) => {
      const [result] = await models.sequelize.query(
        `SELECT COALESCE(SUM(il.borrow_quantity), 0) AS rented_qty
         FROM INVOICE_LINES il
         JOIN INVOICES i ON i.invoice_id = il.invoice_id AND i.is_deleted = 0
         WHERE il.line_status = 'Active'
           AND il.borrow_date <= :day
           AND (
             il.actual_return_date >= :day
             OR (il.actual_return_date IS NULL AND il.expected_return_date >= :day)
           )
           ${warehouseId ? "AND EXISTS (SELECT 1 FROM EQUIPMENT e WHERE e.equipment_id = il.equipment_id AND e.warehouse_id = :warehouseId)" : ""}`,
        {
          replacements: { day, ...(warehouseId && { warehouseId }) },
          type: models.sequelize.constructor.QueryTypes.SELECT,
        },
      );
      const rented = parseInt(result.rented_qty) || 0;
      const utilization = Math.min(100, Math.round((rented / totalOwned) * 100));
      return { date: day, rented, utilization };
    }),
  );

  const currentRate = sparklineData[sparklineData.length - 1]?.utilization ?? 0;

  return { sparklineData, currentRate, totalOwned };
};

// ============================================================================
// 5. RETURNS DUE TODAY (and overdue)
// ============================================================================
export const getReturnsDueToday = async (models, { warehouseId } = {}) => {
  const rows = await models.sequelize.query(
    `SELECT
      il.line_id,
      i.invoice_id,
      c.first_name,
      c.last_name,
      c.company_name,
      c.customer_type,
      c.phone_number,
      e.equipment_name,
      il.expected_return_date,
      ${unitsOutExpr("il")} AS borrow_quantity,
      DATEDIFF(CURDATE(), il.expected_return_date) AS days_overdue
    FROM INVOICE_LINES il
    JOIN INVOICES i   ON i.invoice_id   = il.invoice_id AND i.is_deleted = 0
    JOIN CUSTOMERS c  ON c.customer_id  = i.customer_id
    JOIN EQUIPMENT e  ON e.equipment_id = il.equipment_id
    WHERE ${lineStillOutSql("il")}
      AND il.expected_return_date <= CURDATE()
      AND (il.track_overdue IS NULL OR il.track_overdue = TRUE)
      ${warehouseId ? "AND e.warehouse_id = :warehouseId" : ""}
    ORDER BY il.expected_return_date ASC
    LIMIT 60`,
    {
      replacements: warehouseId ? { warehouseId } : {},
      type: models.sequelize.constructor.QueryTypes.SELECT,
    },
  );

  const overdueCount = rows.filter((r) => parseInt(r.days_overdue) > 0).length;

  return { items: rows, total: rows.length, overdueCount };
};

// ============================================================================
// 6. MAINTENANCE QUEUE — open defects
// ============================================================================
export const getMaintenanceQueue = async (models, { warehouseId } = {}) => {
  const rows = await models.sequelize.query(
    `SELECT
      dl.log_id,
      dl.defective_quantity,
      dl.pending_quantity,
      dl.repaired_quantity,
      dl.repair_status,
      dl.reported_date,
      dl.defect_description,
      e.equipment_name,
      e.serial_number,
      ec.category_name,
      u.first_name AS tech_first_name,
      u.last_name  AS tech_last_name
    FROM DEFECT_LOGS dl
    JOIN EQUIPMENT e          ON e.equipment_id  = dl.equipment_id
    JOIN EQUIPMENT_CATEGORIES ec ON ec.category_id = e.category_id
    LEFT JOIN USERS u         ON u.user_id        = dl.assigned_technician_id
    WHERE dl.repair_status IN ('Pending Assignment', 'In Repair', 'Partially Resolved')
      ${warehouseId ? "AND e.warehouse_id = :warehouseId" : ""}
    ORDER BY dl.reported_date ASC
    LIMIT 30`,
    {
      replacements: warehouseId ? { warehouseId } : {},
      type: models.sequelize.constructor.QueryTypes.SELECT,
    },
  );

  const pendingCount = rows.filter((r) => r.repair_status === "Pending Assignment").length;

  return { items: rows, total: rows.length, pendingCount };
};

// ============================================================================
// 7. ROLE TEMPLATES (admin management)
// ============================================================================
export const listTemplates = async (models) => {
  const templates = await models.DashboardTemplate.findAll({
    where: { is_active: true },
    include: [
      { model: models.Role, attributes: ["role_id", "role_name"], required: false },
      { model: models.User, as: "Creator", attributes: ["user_id", "first_name", "last_name"], required: false },
    ],
    order: [["createdAt", "DESC"]],
  });
  return templates;
};

export const upsertTemplate = async (models, payload, creatorUserId) => {
  const { template_id, template_name, role_id, layout_json } = payload;

  if (template_id) {
    const existing = await models.DashboardTemplate.findByPk(template_id);
    if (!existing) throw new Error("Template not found");
    await existing.update({ template_name, role_id, layout_json });
    return existing;
  }

  return models.DashboardTemplate.create({
    template_name,
    role_id: role_id || null,
    layout_json,
    created_by_user_id: creatorUserId,
  });
};

export const deleteTemplate = async (models, templateId) => {
  const template = await models.DashboardTemplate.findByPk(templateId);
  if (!template) throw new Error("Template not found");
  await template.update({ is_active: false });
};

// ============================================================================
// 8. OPEN INVOICES — unpaid money & equipment not yet returned
// ============================================================================
const ALLOWED_OPEN_AGE_DAYS = new Set([0, 7, 14, 30, 90]);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const ALLOWED_CALL_FILTERS = new Set([
  "all",
  "not_called_today",
  "no_answer",
  "promised",
  "promise_missed",
  "call_again_today",
  "calls_to_note",
]);

const parseOpenInvoicesParams = ({
  view,
  olderThanDays = 7,
  onlyOverdue = 0,
  warehouseId = null,
  limit = 50,
  callFilter = null,
} = {}) => {
  if (view !== "money" && view !== "returns") {
    throw new AppError("Invalid view parameter. Expected 'money' or 'returns'.", 400);
  }

  const rawAge = olderThanDays === undefined || olderThanDays === "" ? 7 : Number(olderThanDays);
  if (!Number.isInteger(rawAge) || !ALLOWED_OPEN_AGE_DAYS.has(rawAge)) {
    throw new AppError("Invalid olderThanDays parameter. Expected 0, 7, 14, 30, or 90.", 400);
  }

  let onlyOverdueBool = false;
  if (onlyOverdue === 1 || onlyOverdue === "1" || onlyOverdue === true) {
    onlyOverdueBool = true;
  } else if (
    onlyOverdue !== 0 &&
    onlyOverdue !== "0" &&
    onlyOverdue !== false &&
    onlyOverdue !== undefined &&
    onlyOverdue !== ""
  ) {
    throw new AppError("Invalid onlyOverdue parameter. Expected 0 or 1.", 400);
  }

  const rawLimit = limit === undefined || limit === "" ? 50 : Number(limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
    throw new AppError("Invalid limit parameter. Expected an integer between 1 and 100.", 400);
  }

  let parsedWarehouseId = null;
  if (warehouseId !== null && warehouseId !== undefined && warehouseId !== "") {
    parsedWarehouseId = Number(warehouseId);
    if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
      throw new AppError("Invalid warehouseId parameter.", 400);
    }
  }

  let normalizedCallFilter = null;
  if (callFilter !== null && callFilter !== undefined && callFilter !== "") {
    const cf = String(callFilter).trim();
    if (!ALLOWED_CALL_FILTERS.has(cf)) {
      throw new AppError("Invalid callFilter parameter.", 400);
    }
    normalizedCallFilter = cf === "all" ? null : cf;
  }

  return {
    view,
    olderThanDays: rawAge,
    onlyOverdue: onlyOverdueBool,
    warehouseId: parsedWarehouseId,
    limit: rawLimit,
    callFilter: normalizedCallFilter,
  };
};

const buildAgingBuckets = (unpaidRows) => {
  const buckets = [
    { key: "0_7", count: 0, owed: 0 },
    { key: "8_14", count: 0, owed: 0 },
    { key: "15_30", count: 0, owed: 0 },
    { key: "31_90", count: 0, owed: 0 },
    { key: "90_plus", count: 0, owed: 0 },
  ];

  for (const r of unpaidRows) {
    let idx = 4;
    if (r.age_days <= 7) idx = 0;
    else if (r.age_days <= 14) idx = 1;
    else if (r.age_days <= 30) idx = 2;
    else if (r.age_days <= 90) idx = 3;

    buckets[idx].count += 1;
    buckets[idx].owed = round2(buckets[idx].owed + r.owed);
  }

  return buckets;
};

export const getOpenInvoices = async (models, params = {}) => {
  const { view, olderThanDays, onlyOverdue, warehouseId, limit, callFilter } =
    parseOpenInvoicesParams(params);
  const today = tenantTodayYmd(params.tenantTz);
  const selectType = models.sequelize?.constructor?.QueryTypes?.SELECT || QueryTypes.SELECT;

  const warehouseLinesFilter = warehouseId
    ? "JOIN EQUIPMENT e ON e.equipment_id = il.equipment_id"
    : "";
  const warehouseLinesWhere = warehouseId ? "AND e.warehouse_id = :warehouseId" : "";
  const warehouseOuterWhere = warehouseId
    ? `AND EXISTS (
        SELECT 1 FROM INVOICE_LINES ilw
        JOIN EQUIPMENT ew ON ew.equipment_id = ilw.equipment_id
        WHERE ilw.invoice_id = i.invoice_id AND ew.warehouse_id = :warehouseId
      )`
    : "";

  const rawRows = await models.sequelize.query(
    `SELECT
      i.invoice_id,
      DATE_FORMAT(i.issued_date, '%Y-%m-%d') AS issued_date,
      GREATEST(0, DATEDIFF(:today, DATE(i.issued_date))) AS age_days,
      i.status,
      c.customer_id,
      c.first_name,
      c.last_name,
      c.company_name,
      c.customer_type,
      c.phone_number,
      ${liveTotalExpr("i")} AS live_total,
      COALESCE(p.total_paid, 0) AS paid,
      ${owedExpr("i", "p.total_paid")} AS owed,
      COALESCE(i.accrued_charges, 0) AS accrued_charges,
      COALESCE(lines_agg.units_out, 0) AS units_out,
      DATE_FORMAT(lines_agg.earliest_due_date, '%Y-%m-%d') AS earliest_due_date,
      CASE
        WHEN lines_agg.overdue_due_date IS NULL THEN 0
        ELSE GREATEST(0, DATEDIFF(:today, lines_agg.overdue_due_date))
      END AS days_overdue,
      CASE WHEN lines_agg.units_out > 0 AND lines_agg.overdue_due_date IS NULL THEN 1 ELSE 0 END AS open_ended
    FROM INVOICES i
    JOIN CUSTOMERS c ON c.customer_id = i.customer_id
    LEFT JOIN ${PAID_PER_INVOICE_SQL} p ON p.invoice_id = i.invoice_id
    LEFT JOIN (
      SELECT
        il.invoice_id,
        SUM(${unitsOutExpr("il")}) AS units_out,
        MIN(CASE
          WHEN ${unitsOutExpr("il")} > 0
          THEN il.expected_return_date
          ELSE NULL
        END) AS earliest_due_date,
        MIN(CASE
          WHEN ${unitsOutExpr("il")} > 0
            AND (il.track_overdue IS NULL OR il.track_overdue = TRUE)
          THEN il.expected_return_date
          ELSE NULL
        END) AS overdue_due_date
      FROM INVOICE_LINES il
      ${warehouseLinesFilter}
      WHERE ${lineStillOutSql("il")}
        ${warehouseLinesWhere}
      GROUP BY il.invoice_id
    ) lines_agg ON lines_agg.invoice_id = i.invoice_id
    WHERE i.status IN ${OPEN_INVOICE_STATUSES_SQL}
      AND i.is_deleted = 0
      ${warehouseOuterWhere}`,
    {
      replacements: { today, ...(warehouseId ? { warehouseId } : {}) },
      type: selectType,
    },
  );

  const normalized = (rawRows || [])
    .map((r) => {
      const owed = round2(Math.max(0, Number(r.owed) || 0));
      const unitsOut = parseInt(r.units_out, 10) || 0;
      const isUnpaid = owed > 0.009;
      const hasItemsOut = unitsOut > 0;
      const customerName =
        r.customer_type === "Business" && r.company_name
          ? r.company_name
          : `${r.first_name || ""} ${r.last_name || ""}`.trim();

      return {
        invoice_id: Number(r.invoice_id),
        issued_date: r.issued_date ? String(r.issued_date).slice(0, 10) : null,
        age_days: Math.max(0, parseInt(r.age_days, 10) || 0),
        status: r.status,
        customer: {
          customer_id: Number(r.customer_id),
          name: customerName,
          phone_number: r.phone_number || null,
        },
        live_total: round2(Number(r.live_total) || 0),
        paid: round2(Number(r.paid) || 0),
        owed,
        accrued_charges: round2(Number(r.accrued_charges) || 0),
        units_out: unitsOut,
        items_out: [],
        earliest_due_date: r.earliest_due_date ? String(r.earliest_due_date).slice(0, 10) : null,
        days_overdue: Math.max(0, parseInt(r.days_overdue, 10) || 0),
        // Every line still out is open-ended (track_overdue off): it has no real due date.
        open_ended: hasItemsOut && Number(r.open_ended) === 1,
        is_unpaid: isUnpaid,
        has_items_out: hasItemsOut,
      };
    })
    .filter((r) => r.is_unpaid || r.has_items_out);

  const buckets = buildAgingBuckets(normalized.filter((r) => r.is_unpaid));

  const ageFiltered =
    olderThanDays > 0 ? normalized.filter((r) => r.age_days >= olderThanDays) : normalized;

  const moneyRowsAll = ageFiltered.filter((r) => r.is_unpaid);
  const returnsRowsAll = ageFiltered.filter(
    (r) => r.has_items_out && (!onlyOverdue || r.days_overdue > 0),
  );
  const bothRowsAll = ageFiltered.filter((r) => r.is_unpaid && r.has_items_out);

  const summary = {
    money: {
      count: moneyRowsAll.length,
      owed: round2(moneyRowsAll.reduce((s, r) => s + r.owed, 0)),
      owedWithItemsOut: round2(bothRowsAll.reduce((s, r) => s + r.owed, 0)),
      accruedCharges: round2(moneyRowsAll.reduce((s, r) => s + r.accrued_charges, 0)),
    },
    returns: {
      count: returnsRowsAll.length,
      unitsOut: returnsRowsAll.reduce((s, r) => s + r.units_out, 0),
      overdueCount: returnsRowsAll.filter((r) => r.days_overdue > 0).length,
    },
    both: {
      count: bothRowsAll.length,
      owed: round2(bothRowsAll.reduce((s, r) => s + r.owed, 0)),
    },
  };

  const unsortedRows =
    view === "money"
      ? [...moneyRowsAll].sort(
          (a, b) =>
            Number(b.has_items_out) - Number(a.has_items_out) ||
            b.owed - a.owed ||
            b.invoice_id - a.invoice_id,
        )
      : [...returnsRowsAll].sort(
          (a, b) =>
            b.days_overdue - a.days_overdue ||
            b.units_out - a.units_out ||
            b.invoice_id - a.invoice_id,
        );

  const customerIdsForCalls = unsortedRows.map((r) => r.customer.customer_id);
  const callSummaryMap = await loadCustomerCallSummaries(models, customerIdsForCalls, {
    tenantTz: params.tenantTz || "Asia/Colombo",
  });
  const callFilterCounts = computeCallFilterCounts(unsortedRows, callSummaryMap, {
    todayYmd: today,
  });

  const targetRows = callFilter
    ? unsortedRows.filter((r) =>
        matchesCallStateFilter(callSummaryMap.get(r.customer.customer_id) || null, callFilter, {
          todayYmd: today,
        }),
      )
    : unsortedRows;

  const totalCount = targetRows.length;
  const pagedRows = targetRows.slice(0, limit);

  for (const row of pagedRows) {
    const summaryObj = callSummaryMap.get(row.customer.customer_id) || null;
    if (summaryObj) {
      const { _called_today, ...cleanSummary } = summaryObj;
      row.last_call = cleanSummary;
    } else {
      row.last_call = null;
    }
  }

  if (pagedRows.length > 0) {
    const invoiceIds = pagedRows.map((r) => r.invoice_id);
    const itemRows = await models.sequelize.query(
      `SELECT
        il.invoice_id,
        e.equipment_name AS name,
        SUM(${unitsOutExpr("il")}) AS qty
      FROM INVOICE_LINES il
      JOIN EQUIPMENT e ON e.equipment_id = il.equipment_id
      WHERE il.invoice_id IN (:invoiceIds)
        AND ${lineStillOutSql("il")}
        ${warehouseLinesWhere}
      GROUP BY il.invoice_id, il.equipment_id, e.equipment_name
      HAVING qty > 0
      ORDER BY qty DESC, e.equipment_name ASC`,
      {
        replacements: { invoiceIds, ...(warehouseId ? { warehouseId } : {}) },
        type: selectType,
      },
    );

    const itemsByInvoice = new Map();
    for (const item of itemRows || []) {
      const invId = Number(item.invoice_id);
      if (!itemsByInvoice.has(invId)) itemsByInvoice.set(invId, []);
      itemsByInvoice.get(invId).push({
        name: item.name,
        qty: parseInt(item.qty, 10) || 0,
      });
    }

    for (const row of pagedRows) {
      row.items_out = itemsByInvoice.get(row.invoice_id) || [];
    }
  }

  return {
    summary,
    buckets,
    rows: pagedRows,
    totalCount,
    callFilterCounts,
  };
};
