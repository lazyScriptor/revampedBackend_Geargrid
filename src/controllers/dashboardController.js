import * as dashboardService from "../services/dashboardService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

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
  const data = await dashboardService.getConfig(models, userId);

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
  const data = await dashboardService.getKPIs(getModels(req), req.query);
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
