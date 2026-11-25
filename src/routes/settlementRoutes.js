import express from "express";
import * as settlementController from "../controllers/customerSettlementController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";
import { freshAccruals } from "../services/accrualService.js";

const router = express.Router();

router.use(protect);
router.use(freshAccruals);

router.get("/:id", requirePermission("invoice:view"), settlementController.getSettlement);
router.post("/:id/void", requirePermission("invoice:edit"), settlementController.voidSettlement);

export default router;
