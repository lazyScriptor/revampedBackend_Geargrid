import express from "express";
import * as bulkInvoiceController from "../controllers/bulkInvoiceController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";
import { requireFeature } from "../middlewares/planMiddleware.js";

const router = express.Router();
router.use(protect);
router.get("/export", requireFeature("data.exports"), requirePermission("data_arena:export"), bulkInvoiceController.exportInvoices);

export default router;
