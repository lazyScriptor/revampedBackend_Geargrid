import express from "express";
import {
  createLog,
  getLogs,
  markResolved,
} from "../controllers/defectLogController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(protect);

router.route("/").get(getLogs).post(createLog);

// PATCH /api/defects/5/resolve
router.patch("/:id/resolve", markResolved);

export default router;
