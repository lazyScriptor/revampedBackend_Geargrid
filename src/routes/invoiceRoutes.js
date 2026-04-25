import express from "express";
import * as invoiceController from "../controllers/invoiceController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Apply the auth middleware to all invoice routes
router.use(protect);

// ==========================================
// INVOICE ENDPOINTS
// ==========================================

// 1. Fetch all historical invoices (GET /api/invoices?page=1&limit=20)
router.get("/", invoiceController.getInvoices);

// 2. Create a new dispatch invoice (POST /api/invoices)
router.post("/", invoiceController.createInvoice);

// 3. Process a return/check-in for a specific invoice (POST /api/invoices/:id/return)
router.post("/:id/return", invoiceController.processReturnInvoice);

export default router;
