import express from "express";
import * as accountingController from "../controllers/accountingController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All accounting routes require authentication
router.use(protect);

// Filtered data endpoints
router.get("/invoices", requirePermission("accounting:view"), accountingController.getInvoices);
router.get("/payments", requirePermission("accounting:view"), accountingController.getPayments);
router.get("/expenses", requirePermission("accounting:view"), accountingController.getExpenses);
router.get("/journal", requirePermission("accounting:view"), accountingController.getJournal);

export default router;
