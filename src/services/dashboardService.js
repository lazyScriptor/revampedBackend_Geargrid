import { Op, fn, col } from "sequelize";
import * as reportService from "./reportService.js";

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
];

const DEFAULT_FILTERS = {
  startDate: (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  })(),
  endDate: new Date().toISOString().split("T")[0],
  warehouseId: null,
};

// ============================================================================
// 1. DASHBOARD CONFIG — effective layout for a user (preference > role template > default)
// ============================================================================
export const getConfig = async (models, userId) => {
  const pref = await models.UserDashboardPreference.findOne({ where: { user_id: userId } });

  if (pref?.custom_layout_json?.length > 0) {
    return {
      layout: pref.custom_layout_json,
      savedFilters: pref.saved_filters_json || DEFAULT_FILTERS,
      widgetCatalog: WIDGET_CATALOG,
      source: "user",
    };
  }

  // Fallback: find any active template for the user's roles (handled by controller passing roleId)
  return {
    layout: DEFAULT_LAYOUT,
    savedFilters: DEFAULT_FILTERS,
    widgetCatalog: WIDGET_CATALOG,
    source: "default",
  };
};

export const getConfigForRole = async (models, userId, roleId) => {
  const pref = await models.UserDashboardPreference.findOne({ where: { user_id: userId } });

  if (pref?.custom_layout_json?.length > 0) {
    return {
      layout: pref.custom_layout_json,
      savedFilters: pref.saved_filters_json || DEFAULT_FILTERS,
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
        savedFilters: DEFAULT_FILTERS,
        widgetCatalog: WIDGET_CATALOG,
        source: "role_template",
        template_id: template.template_id,
      };
    }
  }

  return {
    layout: DEFAULT_LAYOUT,
    savedFilters: DEFAULT_FILTERS,
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
    where: warehouseId ? { warehouse_id: warehouseId } : {},
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
         JOIN INVOICES i ON i.invoice_id = il.invoice_id
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
      il.borrow_quantity,
      DATEDIFF(CURDATE(), il.expected_return_date) AS days_overdue
    FROM INVOICE_LINES il
    JOIN INVOICES i   ON i.invoice_id   = il.invoice_id
    JOIN CUSTOMERS c  ON c.customer_id  = i.customer_id
    JOIN EQUIPMENT e  ON e.equipment_id = il.equipment_id
    WHERE il.line_status = 'Active'
      AND il.actual_return_date IS NULL
      AND il.expected_return_date <= CURDATE()
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
