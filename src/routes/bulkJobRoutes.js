import express from "express";
import multer from "multer";
import * as bulkJobController from "../controllers/bulkJobController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";

const router = express.Router();

// 50 MB upload cap — large enough for serious bulk imports, small enough to
// keep memory bounded. Switch to disk-storage later if we need bigger files.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.use(protect);

// Job management
router.get("/", bulkJobController.listJobs);
router.get("/downloads", bulkJobController.listDownloads);
router.get("/:id", bulkJobController.getJob);
router.post("/:id/cancel", bulkJobController.cancelJob);
router.get("/:id/download", bulkJobController.downloadJobOutput);

// Job creation
router.post(
  "/export/:entity",
  requirePermission("inventory_permission"),
  bulkJobController.createExportJob,
);

router.post(
  "/import/:entity",
  requirePermission("inventory_permission"),
  upload.single("file"),
  bulkJobController.createImportJob,
);

export default router;
