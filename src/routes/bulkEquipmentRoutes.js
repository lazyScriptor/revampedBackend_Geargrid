import express from "express";
import multer from "multer";
import * as bulkEquipmentController from "../controllers/bulkEquipmentController.js";
// Import your auth/permission middlewares here if applicable
import { protect, requirePermission } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Configure Multer for in-memory storage (max 5MB file size)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(protect);

// GET /api/equipment/bulk/template
router.get("/template", requirePermission("equipment:action:bulk_import"), bulkEquipmentController.downloadTemplate);

// GET /api/equipment/bulk/export
router.get("/export", requirePermission("data_arena:export"), bulkEquipmentController.exportEquipment);

// POST /api/equipment/bulk/import (Expects form-data with a key named 'csv_file')
router.post(
  "/import",
  requirePermission("equipment:action:bulk_import"),
  upload.single("csv_file"),
  bulkEquipmentController.importEquipment,
);

export default router;
