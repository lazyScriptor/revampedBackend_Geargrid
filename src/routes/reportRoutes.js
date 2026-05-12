import express from "express";
import * as reportController from "../controllers/reportController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All report routes require authentication
router.use(protect);

// Dashboard KPIs
router.get("/dashboard", requirePermission("dashboard:view"), reportController.getDashboard);

// Profit & Loss
router.get("/profit-loss", requirePermission("accounting:view"), reportController.getProfitLoss);
router.get("/profit-loss/pdf", requirePermission("accounting:export_pdf"), reportController.getProfitLossPdf);
router.get("/profit-loss/excel", requirePermission("accounting:export_excel"), reportController.getProfitLossExcel);

// Accounts Receivable
router.get("/accounts-receivable", requirePermission("accounting:view"), reportController.getAccountsReceivable);
router.get("/accounts-receivable/pdf", requirePermission("accounting:export_pdf"), reportController.getAccountsReceivablePdf);
router.get("/accounts-receivable/excel", requirePermission("accounting:export_excel"), reportController.getAccountsReceivableExcel);

// Equipment Utilization
router.get("/equipment-utilization", requirePermission("accounting:view"), reportController.getEquipmentUtilization);
router.get("/equipment-utilization/excel", requirePermission("accounting:export_excel"), reportController.getEquipmentUtilizationExcel);

// Maintenance Costs
router.get("/maintenance-costs", requirePermission("accounting:view"), reportController.getMaintenanceCosts);

// Daily Cash Flow
router.get("/cash-flow", requirePermission("accounting:view"), reportController.getCashFlow);

export default router;
