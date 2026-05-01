import express from "express";
import * as invoiceController from "../controllers/invoiceController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Apply the auth middleware to all invoice routes
router.use(protect);

// 1. Core Invoicing
router.get("/", invoiceController.getInvoices);
router.post("/", invoiceController.createInvoice);
router.get("/:id", invoiceController.getInvoiceById); // <-- NEW

// 2. OMS Actions
router.post("/:id/return", invoiceController.processReturnInvoice);
router.post("/:id/payments", invoiceController.addPayment); // <-- NEW
router.patch("/:id/vault", invoiceController.toggleVault); // <-- NEW
router.patch("/:id/fees", invoiceController.updateFees);

export default router;
