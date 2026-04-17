import express from "express";
import multer from "multer";
import * as bulkEquipmentController from "../controllers/bulkEquipmentController.js";
// Import your auth/permission middlewares here if applicable
// import { protect, restrictTo } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Configure Multer for in-memory storage (max 5MB file size)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// GET /api/equipment/bulk/template
router.get("/template", bulkEquipmentController.downloadTemplate);

// GET /api/equipment/bulk/export
router.get("/export", bulkEquipmentController.exportEquipment);

// POST /api/equipment/bulk/import (Expects form-data with a key named 'csv_file')
router.post(
  "/import",
  upload.single("csv_file"),
  bulkEquipmentController.importEquipment,
);

export default router;
