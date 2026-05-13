import express from "express";
import {
  createRole,
  updateRole,
  deleteRole,
  getRoles,
  assignPermissions,
} from "../controllers/roleController.js";
import { protect, requirePermission, logTenantAuditAction } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(protect);

router.route("/")
  .get(requirePermission("role:view"), getRoles)
  .post(requirePermission("role:create"), logTenantAuditAction("ROLE_CREATED"), createRole);

router.route("/:id")
  .put(requirePermission("role:update"), logTenantAuditAction("ROLE_UPDATED"), updateRole)
  .delete(requirePermission("role:delete"), logTenantAuditAction("ROLE_DELETED"), deleteRole);

router.post("/:id/assign-permissions", requirePermission("role:assign_permission"), logTenantAuditAction("ROLE_PERMISSIONS_ASSIGNED"), assignPermissions);

export default router;
