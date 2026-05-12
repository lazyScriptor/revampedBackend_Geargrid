import express from "express";
import * as invoiceController from "../controllers/invoiceController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Apply the auth middleware to all invoice routes
router.use(protect);

// 1. Core Invoicing
router.get("/", requirePermission("invoice:view"), invoiceController.getInvoices);
router.post("/", requirePermission("invoice:create"), invoiceController.createInvoice);
router.get("/:id", requirePermission("invoice:view"), invoiceController.getInvoiceById); // <-- NEW

// 2. OMS Actions
router.post("/:id/return", requirePermission("invoice:action:process_return"), invoiceController.processReturnInvoice);
router.post("/:id/payments", requirePermission("invoice:action:add_payment"), invoiceController.addPayment); // <-- NEW
router.patch("/:id/vault", requirePermission("invoice:edit"), invoiceController.toggleVault); // <-- NEW
router.patch("/:id/fees", requirePermission("invoice:edit"), invoiceController.updateFees);

export default router;
