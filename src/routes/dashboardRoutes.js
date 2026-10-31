import { Router } from "express";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";
import * as dashboardController from "../controllers/dashboardController.js";
import { freshAccruals } from "../services/accrualService.js";

const router = Router();

router.use(protect);
// Totals include the running charges of machines still out; bring them up to date first.
router.use(freshAccruals);

// User-facing dashboard endpoints
router.get("/config",               dashboardController.getConfig);
router.patch("/preferences",        dashboardController.syncPreferences);
router.delete("/preferences",       dashboardController.deletePreference);
router.get("/kpis",                 dashboardController.getKPIs);
router.get("/utilization-sparkline",dashboardController.getUtilizationSparkline);
router.get("/returns-today",        dashboardController.getReturnsDueToday);
router.get("/maintenance-queue",    dashboardController.getMaintenanceQueue);

// Admin template management
router.get("/templates",            requirePermission("dashboard:manage_templates"), dashboardController.listTemplates);
router.post("/templates",           requirePermission("dashboard:manage_templates"), dashboardController.upsertTemplate);
router.patch("/templates",          requirePermission("dashboard:manage_templates"), dashboardController.upsertTemplate);
router.delete("/templates/:id",     requirePermission("dashboard:manage_templates"), dashboardController.deleteTemplate);

export default router;
