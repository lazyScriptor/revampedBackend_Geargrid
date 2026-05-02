import express from "express";
import multer from "multer";
import * as bulkCustomerController from "../controllers/bulkCustomerController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(protect);
router.get("/template", bulkCustomerController.downloadTemplate);
router.get("/export", bulkCustomerController.exportCustomers);
router.post(
  "/import",
  upload.single("csv_file"),
  bulkCustomerController.importCustomers,
);

export default router;
