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
} from "../controllers/equipmentController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";
import * as photos from "../controllers/equipmentPhotoController.js";

const router = express.Router();

// All equipment routes require the user to be logged in
router.use(protect);

// GET /api/equipment?page=1&limit=20&status=Available&search=Bosch
// POST /api/equipment
router.route("/")
  .get(requirePermission("equipment:view"), getEquipment)
  .post(requirePermission("equipment:create"), createEquipment);

// Aggregated live stats for equipment dashboard
router.get("/stats", requirePermission("equipment:view"), getEquipmentStats);

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
