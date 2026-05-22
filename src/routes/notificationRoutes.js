import express from "express";
import * as notificationController from "../controllers/notificationController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(protect);

router.get("/", notificationController.listNotifications);
router.get("/unread-count", notificationController.unreadCount);
router.post("/mark-all-read", notificationController.markAllRead);
router.patch("/:id/read", notificationController.markRead);
router.delete("/:id", notificationController.removeNotification);

export default router;
