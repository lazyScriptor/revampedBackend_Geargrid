import express from "express";
import {
  createCategory,
  deleteCategory,
  getCategories,
  getSingleCategory,
  updateCategory,
} from "../controllers/categoryController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(protect);

router.route("/").get(getCategories).post(createCategory);

router.route("/:id").get(getSingleCategory).put(updateCategory);

// Add this line to your routes file
router.delete("/:id", deleteCategory);

export default router;
