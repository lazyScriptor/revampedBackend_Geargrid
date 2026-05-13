import express from "express";
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  assignRoles,
  getTechnicianRoster,
  addTechnician,
  editTechnician,
  toggleUserStatus,
} from "../controllers/userController.js";
import { protect, requirePermission, logTenantAuditAction } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(protect);

// --- ENTERPRISE USER ADMINISTRATION ---
router.route("/")
  .get(requirePermission("user:view"), getUsers)
  .post(requirePermission("user:create"), logTenantAuditAction("USER_CREATED"), createUser);

router.route("/:id")
  .put(requirePermission("user:update"), logTenantAuditAction("USER_UPDATED"), updateUser)
  .delete(requirePermission("user:delete"), logTenantAuditAction("USER_DELETED"), deleteUser);

router.post("/:id/assign-roles", requirePermission("user:assign_role"), logTenantAuditAction("USER_ROLES_ASSIGNED"), assignRoles);

// Note: /:id/toggle-status is kept for backward compatibility if needed, but deleteUser (soft delete) replaces it
router.patch("/:id/toggle-status", requirePermission("user:update"), logTenantAuditAction("USER_STATUS_TOGGLED"), toggleUserStatus);

// --- WORKFORCE SPECIFIC (Backward compatibility or specialized views) ---
router.route("/technicians")
  .get(requirePermission("workforce:view"), getTechnicianRoster)
  .post(requirePermission("workforce:manage"), addTechnician);

router.route("/technicians/:id")
  .put(requirePermission("workforce:manage"), editTechnician);

export default router;
