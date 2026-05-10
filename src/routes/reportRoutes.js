import express from "express";
import * as reportController from "../controllers/reportController.js";
import { protect, restrictTo } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All report routes require authentication + Admin or Manager role
router.use(protect);
router.use(restrictTo("Admin", "Manager"));

// Dashboard KPIs
router.get("/dashboard", reportController.getDashboard);

// Profit & Loss
router.get("/profit-loss", reportController.getProfitLoss);
router.get("/profit-loss/pdf", reportController.getProfitLossPdf);
router.get("/profit-loss/excel", reportController.getProfitLossExcel);

// Accounts Receivable
router.get("/accounts-receivable", reportController.getAccountsReceivable);
router.get("/accounts-receivable/pdf", reportController.getAccountsReceivablePdf);
router.get("/accounts-receivable/excel", reportController.getAccountsReceivableExcel);

// Equipment Utilization
router.get("/equipment-utilization", reportController.getEquipmentUtilization);
router.get("/equipment-utilization/excel", reportController.getEquipmentUtilizationExcel);

// Maintenance Costs
router.get("/maintenance-costs", reportController.getMaintenanceCosts);

// Daily Cash Flow
router.get("/cash-flow", reportController.getCashFlow);

export default router;
