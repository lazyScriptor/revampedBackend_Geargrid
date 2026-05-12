import express from "express";
import * as bulkInvoiceController from "../controllers/bulkInvoiceController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(protect);
router.get("/export", requirePermission("data_arena:export"), bulkInvoiceController.exportInvoices);

export default router;
