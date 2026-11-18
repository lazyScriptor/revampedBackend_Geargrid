import express from "express";
import * as bulkEquipmentController from "../controllers/bulkEquipmentController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";
import { requireFeature } from "../middlewares/planMiddleware.js";

const router = express.Router();

router.use(protect);

// GET /api/equipment/bulk/template (?format=xlsx for 3-sheet Excel template)
router.get(
  "/template",
  requireFeature("data.imports"),
  requirePermission("equipment:action:bulk_import"),
  bulkEquipmentController.downloadTemplate,
);

// GET /api/equipment/bulk/export
router.get(
  "/export",
  requireFeature("data.exports"),
  requirePermission("data_arena:export"),
  bulkEquipmentController.exportEquipment,
);

export default router;
