import express from "express";
import {
  createRole,
  updateRole,
  deleteRole,
  getRoles,
  assignPermissions,
  assignUsers,
  getUsersForRole,
} from "../controllers/roleController.js";
import { protect, requirePermission, logTenantAuditAction } from "../middlewares/authMiddleware.js";
import { requireFeature } from "../middlewares/planMiddleware.js";

const router = express.Router();
router.use(protect);

router.route("/")
  .get(requirePermission("role:view"), getRoles)
  .post(requireFeature("admin.roles"), requirePermission("role:create"), logTenantAuditAction("ROLE_CREATED"), createRole);

router.route("/:id")
  .put(requireFeature("admin.roles"), requirePermission("role:update"), logTenantAuditAction("ROLE_UPDATED"), updateRole)
  .delete(requireFeature("admin.roles"), requirePermission("role:delete"), logTenantAuditAction("ROLE_DELETED"), deleteRole);

router.post("/:id/assign-permissions", requireFeature("admin.roles"), requirePermission("role:assign_permission"), logTenantAuditAction("ROLE_PERMISSIONS_ASSIGNED"), assignPermissions);

router.get("/:id/users", requirePermission("role:view"), getUsersForRole);
router.post("/:id/assign-users", requireFeature("admin.roles"), requirePermission("role:assign_permission"), logTenantAuditAction("ROLE_USERS_ASSIGNED"), assignUsers);

export default router;
