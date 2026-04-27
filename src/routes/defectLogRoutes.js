import express from "express";
import * as defectController from "../controllers/defectLogController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(protect);

router.get("/", defectController.getLogs);
router.post("/", defectController.createLog);
router.patch("/:id/assign", defectController.assignTech); // NEW ENDPOINT
router.patch("/:id/resolve", defectController.markResolved);

export default router;
