import express from "express";
import * as invoiceController from "../controllers/invoiceController.js";

// 1. Import your auth middleware!
// (Check your authMiddleware.js file to see exactly what the function is called. It might be 'protect', 'authenticate', or 'requireAuth')
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// 2. CRITICAL FIX: Apply the auth middleware so req.user gets populated
router.use(protect);

// POST /api/invoices - Create a new dispatch invoice
router.post("/", invoiceController.createInvoice);

export default router;
