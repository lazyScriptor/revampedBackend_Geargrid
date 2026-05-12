import express from "express";
import {
  getConfig,
  updateConfig,
} from "../controllers/tenantConfigController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(protect);

// GET /api/config
// PUT /api/config
router.route("/")
  .get(requirePermission("config:view"), getConfig)
  .put(requirePermission("config:manage"), updateConfig);

export default router;
