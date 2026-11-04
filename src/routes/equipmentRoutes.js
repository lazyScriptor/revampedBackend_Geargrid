import express from "express";
import {
  createEquipment,
  getEquipment,
  getSingleEquipment,
  updateEquipment,
  changeStatus,
  deleteEquipment,
  bulkUpdateEquipment,
  getEquipmentStats,
  convertNamesToSinhala,
  getNextEquipment,
  bulkSaveEquipment,
  saveEquipmentSheet,
} from "../controllers/equipmentController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";
import { enforceLimit, requireFeature } from "../middlewares/planMiddleware.js";
import * as photos from "../controllers/equipmentPhotoController.js";

const router = express.Router();

// All equipment routes require the user to be logged in
router.use(protect);

// GET /api/equipment?page=1&limit=20&status=Available&search=Bosch
// POST /api/equipment
router.route("/")
  .get(requirePermission("equipment:view"), getEquipment)
  .post(requirePermission("equipment:create"), enforceLimit("max_equipment"), createEquipment);

// Aggregated live stats for equipment dashboard
router.get("/stats", requirePermission("equipment:view"), getEquipmentStats);

// Next automatic number and name for a new machine (MUST be before /:id)
router.get("/next", requirePermission("equipment:create"), getNextEquipment);

// Add and edit many machines from the grid, all or nothing (MUST be before /:id)
router.post(
  "/bulk-save",
  requireFeature("data.add_machines"),
  requirePermission("equipment:create"),
  requirePermission("equipment:edit"),
  enforceLimit("max_equipment", (req) => (Array.isArray(req.body?.rows) ? req.body.rows.filter((r) => !r.equipment_id).length : 0)),
  bulkSaveEquipment,
);

// The equipment sheet: edits, additions and deletions together, all or nothing (MUST be before /:id)
const whenSheetHas = (list, permission) => (req, res, next) => (req.body?.[list]?.length ? requirePermission(permission)(req, res, next) : next());
router.post(
  "/sheet-save",
  requireFeature("data.equipment_sheet"),
  whenSheetHas("updates", "equipment:edit"),
  whenSheetHas("creates", "equipment:create"),
  whenSheetHas("deletes", "equipment:delete"),
  // Deleting in the same save makes room for what it adds.
  enforceLimit("max_equipment", (req) => (req.body?.creates?.length ?? 0) - (req.body?.deletes?.length ?? 0)),
  saveEquipmentSheet,
);

// Bulk update equipment (MUST be before /:id)
router.patch(
  "/bulk",
  requirePermission("equipment:bulk_edit", "equipment:edit"),
  bulkUpdateEquipment,
);

// One-click: translate equipment names to Sinhala (MUST be before /:id)
router.post("/convert-names-si", requirePermission("equipment:edit"), convertNamesToSinhala);

// Photos — tap the picture in the equipment table (MUST be before /:id)
// GET    /api/equipment/photo-requests/:token  → status of a phone request
// DELETE /api/equipment/photo-requests/:token  → cancel it
router
  .route("/photo-requests/:token")
  .get(requirePermission("equipment:edit"), photos.getPhotoRequest)
  .delete(requirePermission("equipment:edit"), photos.cancelPhotoRequest);
// POST   /api/equipment/5/image (multipart "image") → upload from this computer
// DELETE /api/equipment/5/image → back to the standard photo
router
  .route("/:id/image")
  .post(requirePermission("equipment:edit"), photos.receivePhoto, photos.uploadImage)
  .delete(requirePermission("equipment:edit"), photos.resetImage);
// POST   /api/equipment/5/photo-requests → paired phone opens its camera
router.post("/:id/photo-requests", requirePermission("equipment:edit"), photos.createPhotoRequest);

// GET /api/equipment/5
// PUT /api/equipment/5 (Full/Partial update of details like price, name)
router.route("/:id")
  .get(requirePermission("equipment:view"), getSingleEquipment)
  .put(requirePermission("equipment:edit"), updateEquipment);

// PATCH /api/equipment/5/status (Specific endpoint just for changing status)
router.patch("/:id/status", requirePermission("equipment:edit"), changeStatus);
// Add this line to your routes file
router.delete("/:id", requirePermission("equipment:delete"), deleteEquipment);
export default router;
