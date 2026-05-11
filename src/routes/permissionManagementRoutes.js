import express from "express";
import * as permMgmtController from "../controllers/permissionManagementController.js";
import { protect, restrictTo } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All permission management routes require auth + admin role
router.use(protect);
router.use(restrictTo("Admin"));

// Full permission matrix (roles + users + overrides)
router.get("/matrix", permMgmtController.getPermissionMatrix);

// User-level overrides
router.post("/user-override", permMgmtController.setUserOverride);
router.delete("/user-override", permMgmtController.removeUserOverride);

// Clone permissions between roles
router.post("/clone-role", permMgmtController.cloneRolePermissions);

// Get effective permissions for a specific user
router.get(
  "/effective/:userId",
  permMgmtController.getUserEffectivePermissions,
);

export default router;
