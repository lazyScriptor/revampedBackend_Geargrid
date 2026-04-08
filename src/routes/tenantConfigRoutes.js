import express from "express";
import {
  getConfig,
  updateConfig,
} from "../controllers/tenantConfigController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(protect);

// GET /api/config
// PUT /api/config
router.route("/").get(getConfig).put(updateConfig);

export default router;
