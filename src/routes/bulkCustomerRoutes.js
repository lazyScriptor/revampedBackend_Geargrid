import express from "express";
import multer from "multer";
import * as bulkCustomerController from "../controllers/bulkCustomerController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(protect);
router.get("/template", requirePermission("customer:action:bulk_import"), bulkCustomerController.downloadTemplate);
router.get("/export", requirePermission("data_arena:export"), bulkCustomerController.exportCustomers);
router.post(
  "/import",
  requirePermission("customer:action:bulk_import"),
  upload.single("csv_file"),
  bulkCustomerController.importCustomers,
);

export default router;
