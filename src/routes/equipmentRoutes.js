import express from "express";
import {
  createEquipment,
  getEquipment,
  getSingleEquipment,
  updateEquipment,
  changeStatus,
  deleteEquipment,
} from "../controllers/equipmentController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All equipment routes require the user to be logged in
router.use(protect);

// GET /api/equipment?page=1&limit=20&status=Available&search=Bosch
// POST /api/equipment
router.route("/")
  .get(requirePermission("equipment:view"), getEquipment)
  .post(requirePermission("equipment:create"), createEquipment);

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
