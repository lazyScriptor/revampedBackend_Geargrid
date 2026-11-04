import express from "express";
import * as accountingController from "../controllers/accountingController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";
import { requireFeature } from "../middlewares/planMiddleware.js";
import { freshAccruals } from "../services/accrualService.js";

const router = express.Router();

// All accounting routes require authentication
router.use(protect);
// Totals include the running charges of machines still out; bring them up to date first.
router.use(freshAccruals);

// Filtered data endpoints
router.get("/invoices", requireFeature("accounting.invoices"), requirePermission("accounting:view"), accountingController.getInvoices);
router.get("/payments", requireFeature("accounting.payments"), requirePermission("accounting:view"), accountingController.getPayments);
router.get("/expenses", requireFeature("accounting.expenses"), requirePermission("accounting:view"), accountingController.getExpenses);
router.get("/journal", requireFeature("accounting.journal"), requirePermission("accounting:view"), accountingController.getJournal);
router.get("/charts", requireFeature("accounting.overview"), requirePermission("accounting:view"), accountingController.getCharts);

export default router;
