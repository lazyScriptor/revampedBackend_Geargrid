import express from "express";
import * as defectController from "../controllers/defectLogController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(protect);

// Must be before /:id to avoid param capture
router.get("/my-tickets", defectController.getMyLogs);

router.get("/", requirePermission("defect:view"), defectController.getLogs);
router.post("/", requirePermission("defect:create"), defectController.createLog);
router.patch("/:id/assign", requirePermission("defect:assign_technician"), defectController.assignTech); // NEW ENDPOINT
router.patch("/:id/resolve", requirePermission("defect:resolve"), defectController.markResolved);

export default router;
