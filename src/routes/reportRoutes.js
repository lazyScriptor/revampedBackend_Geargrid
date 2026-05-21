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

// ─── Reports surface — Customers / Equipment / Invoices ─────────────────────
// Permissions reuse the module-read permissions per category, so a manager
// who can already see customers can also see customer reports without a
// separate grant. The legacy `inventory_permission` covers all three reads
// for tenants that haven't migrated to granular permissions yet.

router.get("/customers/all", requirePermission("inventory_permission"), reportController.getAllCustomers);
router.get("/customers/outstanding", requirePermission("inventory_permission"), reportController.getOutstandingBalances);

router.get("/equipment/maintenance-by-unit", requirePermission("inventory_permission"), reportController.getEquipmentMaintenanceByUnit);

router.get("/invoices/aging", requirePermission("inventory_permission"), reportController.getInvoiceAging);
router.get("/invoices/history", requirePermission("inventory_permission"), reportController.getRentalHistory);

export default router;
