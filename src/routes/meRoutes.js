import express from "express";
import multer from "multer";
import * as meController from "../controllers/meController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// 5 MB cap for avatar uploads — image-only is enforced in the service.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(protect);

router.get("/", meController.getProfile);
router.patch("/", meController.updateProfile);
router.patch("/preferences", meController.updatePreferences);
router.post("/change-password", meController.changePassword);
router.post("/avatar", upload.single("avatar"), meController.uploadAvatar);
router.delete("/avatar", meController.deleteAvatar);
router.get("/activity", meController.getActivity);
router.get("/recent-work", meController.getRecentWork);

export default router;
