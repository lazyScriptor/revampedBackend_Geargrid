import express from "express";
import * as superAdminController from "../controllers/superAdminController.js";
import {
  protectSuperAdmin,
  logAuditAction,
} from "../middlewares/superAdminAuth.js";

const router = express.Router();

router.post("/login", superAdminController.login);

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
  "/tenants/:id/activate",
  logAuditAction("TENANT_ACTIVATED"),
  superAdminController.activateTenant,
);
router.post(
  "/tenants/:id/mark-overdue",
  logAuditAction("TENANT_MARKED_OVERDUE"),
  superAdminController.markTenantOverdue,
);
router.post(
  "/tenants/:id/impersonate",
  logAuditAction("IMPERSONATION_STARTED"),
  superAdminController.impersonate,
);

// Payment / Billing
router.get("/tenants/:id/payments", superAdminController.getPaymentHistory);
router.post(
  "/tenants/:id/payments",
  logAuditAction("PAYMENT_RECORDED"),
  superAdminController.recordPayment,
);

// Tenant Users (for impersonation picker)
router.get("/tenants/:id/users", superAdminController.getTenantUsers);

// Global CORS Management
router.get("/cors", superAdminController.getGlobalCors);
router.patch(
  "/cors",
  logAuditAction("CORS_UPDATED"),
  superAdminController.updateGlobalCors,
);

// Audit Log
router.get("/audit-log", superAdminController.getAuditLog);

export default router;
