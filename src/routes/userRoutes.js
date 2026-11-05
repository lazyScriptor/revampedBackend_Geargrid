import express from "express";
import {
  getUsers,
  createUser,
  createResetCode,
  updateUser,
  deleteUser,
  permanentlyDeleteUser,
  assignRoles,
  getTechnicianRoster,
  addTechnician,
  editTechnician,
  toggleUserStatus,
} from "../controllers/userController.js";
import { protect, requirePermission, logTenantAuditAction } from "../middlewares/authMiddleware.js";
import { enforceLimit, requireFeature } from "../middlewares/planMiddleware.js";

const router = express.Router();
router.use(protect);

// --- WORKFORCE SPECIFIC (must be before /:id to avoid param capture) ---
router.route("/technicians")
  .get(requireFeature("workforce"), requirePermission("workforce:view"), getTechnicianRoster)
  .post(requireFeature("workforce"), requirePermission("workforce:manage"), enforceLimit("max_users"), addTechnician);

router.route("/technicians/:id")
  .put(requireFeature("workforce"), requirePermission("workforce:manage"), editTechnician)
  .patch(requireFeature("workforce"), requirePermission("workforce:manage"), editTechnician);

// --- ENTERPRISE USER ADMINISTRATION ---
router.route("/")
  .get(requirePermission("user:view"), getUsers)
  .post(requirePermission("user:create"), enforceLimit("max_users"), logTenantAuditAction("USER_CREATED"), createUser);

router.post("/:id/reset-code", requirePermission("user:update"), logTenantAuditAction("USER_RESET_CODE_CREATED"), createResetCode);

router.route("/:id")
  .put(requirePermission("user:update"), logTenantAuditAction("USER_UPDATED"), updateUser)
  .delete(requirePermission("user:delete"), logTenantAuditAction("USER_DELETED"), deleteUser);

router.delete("/:id/permanent", requirePermission("user:delete"), logTenantAuditAction("USER_REMOVED_PERMANENTLY"), permanentlyDeleteUser);

router.post("/:id/assign-roles", requirePermission("user:assign_role"), logTenantAuditAction("USER_ROLES_ASSIGNED"), assignRoles);

router.patch("/:id/toggle-status", requirePermission("user:update"), enforceLimit("max_users", (req) => (req.body?.isActive ? 1 : 0)), logTenantAuditAction("USER_STATUS_TOGGLED"), toggleUserStatus);

export default router;
