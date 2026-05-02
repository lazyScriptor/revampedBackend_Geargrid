import express from "express";
import * as bulkInvoiceController from "../controllers/bulkInvoiceController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(protect);
router.get("/export", bulkInvoiceController.exportInvoices);

export default router;
