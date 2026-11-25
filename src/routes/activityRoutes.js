import express from "express";
import * as activityController from "../controllers/activityController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect);

// Settings — any signed-in staff can read reasons & review tags for POS/return dialogs;
// only config managers can update thresholds, reasons, tags, or role visibility.
router.get("/settings", activityController.getActivitySettings);
router.put("/settings", requirePermission("config:manage"), activityController.updateActivitySettings);

router.get("/summary", requirePermission("activity:view"), activityController.getActivitySummary);
router.get("/export", requirePermission("activity:view"), activityController.exportActivity);
router.post("/read", requirePermission("activity:view"), activityController.markRead);
router.get("/", requirePermission("activity:view"), activityController.listActivity);

router.post("/:id/check", requirePermission("activity:check"), activityController.checkEvent);
router.delete("/:id/check", requirePermission("activity:check"), activityController.uncheckEvent);
router.get("/:id/comments", requirePermission("activity:view"), activityController.listComments);
router.post("/:id/comments", requirePermission("activity:view"), activityController.addComment);

export default router;
