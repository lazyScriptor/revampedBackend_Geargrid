import * as dashboardService from "../services/dashboardService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import * as categoryReportService from "../services/categoryReportService.js";
import catchAsync from "../utils/catchAsync.js";
import { resolveTenantTz } from "../utils/dateRange.js";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

// ============================================================================
// CONFIG — effective layout + widget catalog for the requesting user
// ============================================================================
export const getConfig = catchAsync(async (req, res) => {
  const models = getModels(req);
  const userId = req.user.userId;
  const data = await dashboardService.getConfig(models, userId, resolveTenantTz(req));

  // Prevent browser HTTP caching so resets are reflected immediately
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ status: "success", data });
});

// ============================================================================
// SYNC — debounced PATCH to persist layout + filters
// ============================================================================
export const syncPreferences = catchAsync(async (req, res) => {
  const { layout, filters } = req.body;
  const userId = req.user.userId;
  const models = getModels(req);

  await dashboardService.syncPreferences(models, userId, { layout, filters });

  res.status(200).json({ status: "success", message: "Preferences saved." });
});

// ============================================================================
// KPIs — revenue, profit, debt, active rentals
// ============================================================================
export const getKPIs = catchAsync(async (req, res) => {
  const data = await dashboardService.getKPIs(getModels(req), {
    ...req.query,
    tenantTz: resolveTenantTz(req),
  });
  res.status(200).json({ status: "success", data });
});

// ============================================================================
// UTILIZATION SPARKLINE — 7-day fleet utilization
// ============================================================================
export const getUtilizationSparkline = catchAsync(async (req, res) => {
  const { warehouseId } = req.query;
  const data = await dashboardService.getUtilizationSparkline(getModels(req), {
    warehouseId: warehouseId ? parseInt(warehouseId) : null,
  });
  res.status(200).json({ status: "success", data });
});

// ============================================================================
// RETURNS DUE TODAY
// ============================================================================
export const getReturnsDueToday = catchAsync(async (req, res) => {
  const { warehouseId } = req.query;
  const data = await dashboardService.getReturnsDueToday(getModels(req), {
    warehouseId: warehouseId ? parseInt(warehouseId) : null,
  });
  res.status(200).json({ status: "success", data });
});

// ============================================================================
// MAINTENANCE QUEUE
// ============================================================================
export const getMaintenanceQueue = catchAsync(async (req, res) => {
  const { warehouseId } = req.query;
  const data = await dashboardService.getMaintenanceQueue(getModels(req), {
    warehouseId: warehouseId ? parseInt(warehouseId) : null,
  });
  res.status(200).json({ status: "success", data });
});

// ============================================================================
// OPEN INVOICES (money owed & equipment not returned)
// ============================================================================
export const getOpenInvoices = catchAsync(async (req, res) => {
  const { view, olderThanDays, onlyOverdue, warehouseId, limit, callFilter } = req.query;
  const data = await dashboardService.getOpenInvoices(getModels(req), {
    view,
    olderThanDays,
    onlyOverdue,
    warehouseId: warehouseId ? parseInt(warehouseId, 10) : null,
    limit,
    callFilter,
    tenantTz: resolveTenantTz(req),
  });
  res.status(200).json({ status: "success", data });
});

// ============================================================================
// TEMPLATES (admin management)
// ============================================================================
export const listTemplates = catchAsync(async (req, res) => {
  const data = await dashboardService.listTemplates(getModels(req));
  res.status(200).json({ status: "success", data });
});

export const upsertTemplate = catchAsync(async (req, res) => {
  const data = await dashboardService.upsertTemplate(
    getModels(req),
    req.body,
    req.user.userId,
  );
  res.status(200).json({ status: "success", data });
});

export const deletePreference = catchAsync(async (req, res) => {
  const models = getModels(req);
  await models.UserDashboardPreference.destroy({ where: { user_id: req.user.userId } });
  res.status(200).json({ status: "success", message: "Dashboard reset to default." });
});

export const deleteTemplate = catchAsync(async (req, res) => {
  await dashboardService.deleteTemplate(getModels(req), parseInt(req.params.id));
  res.status(200).json({ status: "success", message: "Template deleted." });
});

// ============================================================================
// EQUIPMENT INSIGHTS (category revenue, top earners, idle machines widgets)
// ============================================================================
export const getEquipmentInsights = catchAsync(async (req, res) => {
  const { startDate, endDate, warehouseId } = req.query;
  const data = await categoryReportService.getEquipmentPerformance(getModels(req), {
    startDate, endDate, warehouseId, tenantTz: resolveTenantTz(req),
  });
  // Widgets only need the headline lists, not every machine.
  const families = data.families.map(({ machinesList, types, ...f }) => ({ ...f, types: types.map(({ machinesList: _m, ...t }) => t) }));
  res.status(200).json({ status: "success", data: { dateRange: data.dateRange, totals: data.totals, families, topEarners: data.topEarners, idleMachines: data.idleMachines.slice(0, 10) } });
});
