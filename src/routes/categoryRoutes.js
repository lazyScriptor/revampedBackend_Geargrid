import express from "express";
import {
  createCategory,
  applyOrganize,
  deleteCategory,
  getCategories,
  getSingleCategory,
  previewOrganize,
  updateCategory,
} from "../controllers/categoryController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(protect);

router.route("/")
  .get(requirePermission("category:view"), getCategories)
  .post(requirePermission("category:create"), createCategory);

// Build families and sizes from machine names: preview first, then apply.
router.get("/organize/preview", requirePermission("category:edit"), previewOrganize);
router.post("/organize/apply", requirePermission("category:edit"), applyOrganize);

router.route("/:id")
  .get(requirePermission("category:view"), getSingleCategory)
  .put(requirePermission("category:edit"), updateCategory);

// Add this line to your routes file
router.delete("/:id", requirePermission("category:delete"), deleteCategory);

export default router;
