// equipmentReportService.js — per-unit equipment breakdown for the Reports
// surface. The existing reportService.getMaintenanceCostAnalysis aggregates by
// category; this one drills down to the individual equipment row.

import { parseTenantDayRange } from "../utils/dateRange.js";

export const getEquipmentMaintenanceByUnit = async (models, filters = {}) => {
  const { start, end, startYmd, endYmd } = parseTenantDayRange(
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
        COALESCE(d.defect_count, 0) AS defect_count,
        COALESCE(d.pending_units, 0) AS pending_units,
        COALESCE(d.repaired_units, 0) AS repaired_units,
        COALESCE(d.avg_turnaround_days, 0) AS avg_turnaround_days,
        COALESCE(rev.total_revenue, 0) AS period_revenue
      FROM EQUIPMENT e
      LEFT JOIN EQUIPMENT_CATEGORIES ec ON ec.category_id = e.category_id
      LEFT JOIN WAREHOUSES w ON w.warehouse_id = e.warehouse_id
      LEFT JOIN (
        SELECT
          equipment_id,
          COUNT(*) AS defect_count,
          SUM(pending_quantity) AS pending_units,
          SUM(repaired_quantity) AS repaired_units,
          AVG(DATEDIFF(COALESCE(resolved_date, CURDATE()), reported_date)) AS avg_turnaround_days
        FROM DEFECT_LOGS
        WHERE reported_date BETWEEN :rangeStart AND :rangeEnd
        GROUP BY equipment_id
      ) d ON d.equipment_id = e.equipment_id
      LEFT JOIN (
        SELECT il.equipment_id, SUM(il.line_total_amount) AS total_revenue
        FROM INVOICE_LINES il
        JOIN INVOICES i ON i.invoice_id = il.invoice_id
        WHERE i.issued_date BETWEEN :rangeStart AND :rangeEnd
        GROUP BY il.equipment_id
      ) rev ON rev.equipment_id = e.equipment_id
      ORDER BY defect_count DESC, period_revenue DESC`,
    {
      replacements: { rangeStart: start, rangeEnd: end },
      type: models.sequelize.constructor.QueryTypes.SELECT,
    },
  );

  const totals = rows.reduce(
    (acc, r) => {
      acc.totalDefects += parseInt(r.defect_count) || 0;
      acc.totalPending += parseInt(r.pending_units) || 0;
      acc.totalRepaired += parseInt(r.repaired_units) || 0;
      acc.totalRevenue += parseFloat(r.period_revenue) || 0;
      return acc;
    },
    { totalDefects: 0, totalPending: 0, totalRepaired: 0, totalRevenue: 0 },
  );

  return { rows, totals, dateRange: { startDate: startYmd, endDate: endYmd } };
};
