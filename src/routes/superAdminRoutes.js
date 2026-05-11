import express from "express";
import * as superAdminController from "../controllers/superAdminController.js";
import {
  protectSuperAdmin,
  logAuditAction,
} from "../middlewares/superAdminAuth.js";

const router = express.Router();

// --- Public: Super Admin Login ---
router.post("/login", superAdminController.login);

// --- All routes below require Super Admin authentication ---
router.use(protectSuperAdmin);

router.get("/verify", superAdminController.verifyAuth);
router.post("/logout", superAdminController.logout);

// Dashboard
router.get("/dashboard", superAdminController.getDashboard);

// Tenant Management
router.get("/tenants", superAdminController.getAllTenants);
router.get("/tenants/:id", superAdminController.getTenantDetails);
router.patch(
  "/tenants/:id",
  logAuditAction("TENANT_UPDATED"),
  superAdminController.updateTenant,
);
router.post(
  "/tenants/:id/suspend",
  logAuditAction("TENANT_SUSPENDED"),
  superAdminController.suspendTenant,
);
router.post(
  "/tenants/:id/impersonate",
  logAuditAction("IMPERSONATION_STARTED"),
  superAdminController.impersonate,
);

// Audit Log
router.get("/audit-log", superAdminController.getAuditLog);

export default router;
