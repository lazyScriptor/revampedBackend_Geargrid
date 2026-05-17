import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import * as superAdminController from "../controllers/superAdminController.js";
import {
  protectSuperAdmin,
  logAuditAction,
} from "../middlewares/superAdminAuth.js";

const LOGO_DIR = "uploads/logos";
fs.mkdirSync(LOGO_DIR, { recursive: true });

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, LOGO_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safe = `${req.params.id}-${Date.now()}${ext || ".png"}`;
      cb(null, safe);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed."));
  },
});

const router = express.Router();

router.post("/login", superAdminController.login);

router.use(protectSuperAdmin);

router.get("/verify", superAdminController.verifyAuth);
router.post("/logout", superAdminController.logout);

// Dashboard
router.get("/dashboard", superAdminController.getDashboard);

// Tenant Management
router.post(
  "/tenants",
  logAuditAction("TENANT_CREATED"),
  superAdminController.createTenant,
);
router.get("/tenants", superAdminController.getAllTenants);
router.get("/tenants/:id", superAdminController.getTenantDetails);
router.patch(
  "/tenants/:id",
  logAuditAction("TENANT_UPDATED"),
  superAdminController.updateTenant,
);
router.post(
  "/tenants/:id/logo",
  logAuditAction("TENANT_LOGO_UPLOADED"),
  logoUpload.single("logo"),
  superAdminController.uploadTenantLogo,
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

// Tenant Users — full CRUD
router.get("/tenants/:id/roles", superAdminController.getTenantRoles);
router.get("/tenants/:id/users", superAdminController.getTenantUsers);
router.post(
  "/tenants/:id/users",
  logAuditAction("TENANT_USER_CREATED"),
  superAdminController.createTenantUser,
);
router.patch(
  "/tenants/:id/users/:userId",
  logAuditAction("TENANT_USER_UPDATED"),
  superAdminController.updateTenantUser,
);
router.delete(
  "/tenants/:id/users/:userId",
  logAuditAction("TENANT_USER_DELETED"),
  superAdminController.deleteTenantUser,
);

// Global CORS Management
router.get("/cors", superAdminController.getGlobalCors);
router.patch(
  "/cors",
  logAuditAction("CORS_UPDATED"),
  superAdminController.updateGlobalCors,
);

// Audit Log
router.get("/audit-log", superAdminController.getAuditLog);

// Contact Inquiries
router.get("/inquiries", superAdminController.listInquiries);
router.get("/inquiries/stats", superAdminController.getInquiryStats);
router.get("/inquiries/:id", superAdminController.getInquiry);
router.patch(
  "/inquiries/:id",
  logAuditAction("INQUIRY_UPDATED"),
  superAdminController.updateInquiry,
);
router.delete(
  "/inquiries/:id",
  logAuditAction("INQUIRY_DELETED"),
  superAdminController.deleteInquiry,
);

export default router;
