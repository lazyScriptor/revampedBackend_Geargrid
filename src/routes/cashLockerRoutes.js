import express from "express";
import * as locker from "../controllers/cashLockerController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect);

// Counting the drawer (cashier)
router.get("/status", requirePermission("locker:count", "locker:manage"), locker.getStatus);
router.post("/opening", requirePermission("locker:count"), locker.recordOpening);
router.post("/closing", requirePermission("locker:count"), locker.recordClosing);
router.post("/expenses", requirePermission("locker:count"), locker.recordExpense);
router.patch("/payments/:id/method", requirePermission("locker:count"), locker.changePaymentMethod);

// Owner
router.get("/start", requirePermission("locker:manage"), locker.getStartPreview);
router.post("/start", requirePermission("locker:manage"), locker.startLocker);
router.get("/history", requirePermission("locker:manage"), locker.listHistory);
router.patch("/counts/:id/review", requirePermission("locker:manage"), locker.reviewCount);
router.put("/float", requirePermission("locker:manage"), locker.setFloat);
router.patch("/invoices/:id/advance-at-home", requirePermission("locker:manage"), locker.setAdvanceAtHome);

export default router;
