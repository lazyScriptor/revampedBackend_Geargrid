import express from "express";
import * as reportController from "../controllers/reportController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";
import { requireFeature } from "../middlewares/planMiddleware.js";
import { freshAccruals } from "../services/accrualService.js";

const router = express.Router();

// All report routes require authentication
router.use(protect);
// Totals include the running charges of machines still out; bring them up to date first.
router.use(freshAccruals);

// Dashboard KPIs
router.get("/dashboard", requirePermission("dashboard:view"), reportController.getDashboard);

// Profit & Loss
router.get("/profit-loss", requireFeature("reports.financials"), requirePermission("accounting:view"), reportController.getProfitLoss);
router.get("/profit-loss/pdf", requireFeature("reports.financials"), requirePermission("accounting:export_pdf"), reportController.getProfitLossPdf);
router.get("/profit-loss/excel", requireFeature("reports.financials"), requirePermission("accounting:export_excel"), reportController.getProfitLossExcel);

// Accounts Receivable
router.get("/accounts-receivable", requireFeature("accounting.receivables"), requirePermission("accounting:view"), reportController.getAccountsReceivable);
router.get("/accounts-receivable/pdf", requireFeature("accounting.receivables"), requirePermission("accounting:export_pdf"), reportController.getAccountsReceivablePdf);
router.get("/accounts-receivable/excel", requireFeature("accounting.receivables"), requirePermission("accounting:export_excel"), reportController.getAccountsReceivableExcel);

// Equipment Utilization
router.get("/equipment-utilization", requireFeature("reports.equipment"), requirePermission("accounting:view"), reportController.getEquipmentUtilization);
router.get("/equipment-utilization/excel", requireFeature("reports.equipment"), requirePermission("accounting:export_excel"), reportController.getEquipmentUtilizationExcel);

// Maintenance Costs
router.get("/maintenance-costs", requireFeature("reports.equipment"), requirePermission("accounting:view"), reportController.getMaintenanceCosts);

// Daily Cash Flow
router.get("/cash-flow", requireFeature("reports.financials"), requirePermission("accounting:view"), reportController.getCashFlow);

// ─── Reports surface — Customers / Equipment / Invoices ─────────────────────
// Permissions reuse the module-read permissions per category, so a manager
// who can already see customers can also see customer reports without a
// separate grant. The legacy `inventory_permission` covers all three reads
// for tenants that haven't migrated to granular permissions yet.

router.get("/customers/all", requireFeature("reports.customers"), requirePermission("inventory_permission"), reportController.getAllCustomers);
router.get("/customers/outstanding", requireFeature("reports.customers"), requirePermission("inventory_permission"), reportController.getOutstandingBalances);

router.get("/equipment/maintenance-by-unit", requireFeature("reports.equipment"), requirePermission("inventory_permission"), reportController.getEquipmentMaintenanceByUnit);

router.get("/invoices/aging", requireFeature("reports.invoices"), requirePermission("inventory_permission"), reportController.getInvoiceAging);
router.get("/invoices/history", requireFeature("reports.invoices"), requirePermission("inventory_permission"), reportController.getRentalHistory);

export default router;
