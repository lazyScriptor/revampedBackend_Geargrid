import * as superAdminAuthService from "../services/superAdminAuthService.js";
import * as superAdminTenantService from "../services/superAdminTenantService.js";
import * as superAdminInquiryService from "../services/superAdminInquiryService.js";
import catchAsync from "../utils/catchAsync.js";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
};

// ============================================================================
// AUTH
// ============================================================================
export const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  const { token, admin } = await superAdminAuthService.loginSuperAdmin(
    email,
    password,
  );

  res.cookie("superAdminToken", token, {
    ...cookieOptions,
    maxAge: 8 * 60 * 60 * 1000,
  });

  res.status(200).json({ status: "success", data: { admin } });
});

export const logout = (req, res) => {
  res.clearCookie("superAdminToken");
  res.status(200).json({ status: "success", message: "Logged out." });
};

export const verifyAuth = (req, res) => {
  res.status(200).json({
    status: "success",
    data: {
      admin: {
        id: req.superAdmin.superAdminId,
        email: req.superAdmin.email,
        displayName: req.superAdmin.displayName,
      },
    },
  });
};

// ============================================================================
// DASHBOARD
// ============================================================================
export const getDashboard = catchAsync(async (req, res) => {
  const data = await superAdminTenantService.getPlatformDashboard();
  res.status(200).json({ status: "success", data });
});

// ============================================================================
// TENANT MANAGEMENT
// ============================================================================
export const createTenant = catchAsync(async (req, res) => {
  const tenant = await superAdminTenantService.createTenant(req.body);
  res.status(201).json({ status: "success", data: { tenant } });
});

export const getAllTenants = catchAsync(async (req, res) => {
  const tenants = await superAdminTenantService.getAllTenants();
  res.status(200).json({ status: "success", data: { tenants } });
});

export const getTenantDetails = catchAsync(async (req, res) => {
  const data = await superAdminTenantService.getTenantDetails(req.params.id);
  res.status(200).json({ status: "success", data });
});

export const updateTenant = catchAsync(async (req, res) => {
  const tenant = await superAdminTenantService.updateTenantConfig(
    req.params.id,
    req.body,
  );
  res.status(200).json({ status: "success", data: { tenant } });
});

export const uploadTenantLogo = catchAsync(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: "fail", message: "No file uploaded." });
  }
  const publicUrl = `/uploads/logos/${req.file.filename}`;
  const tenant = await superAdminTenantService.saveTenantLogo(req.params.id, publicUrl);
  res.status(200).json({ status: "success", data: { tenant, logoUrl: publicUrl } });
});

export const suspendTenant = catchAsync(async (req, res) => {
  const tenant = await superAdminTenantService.suspendTenant(req.params.id);
  res.status(200).json({ status: "success", message: "Tenant suspended.", data: { tenant } });
});

export const activateTenant = catchAsync(async (req, res) => {
  const tenant = await superAdminTenantService.activateTenant(req.params.id);
  res.status(200).json({ status: "success", message: "Tenant activated.", data: { tenant } });
});

export const markTenantOverdue = catchAsync(async (req, res) => {
  const tenant = await superAdminTenantService.markTenantOverdue(req.params.id);
  res.status(200).json({ status: "success", message: "Tenant marked overdue.", data: { tenant } });
});

// ============================================================================
// PAYMENT / BILLING
// ============================================================================
export const recordPayment = catchAsync(async (req, res) => {
  const payment = await superAdminTenantService.recordPayment(
    req.params.id,
    req.body,
  );
  res.status(201).json({ status: "success", data: { payment } });
});

export const getPaymentHistory = catchAsync(async (req, res) => {
  const payments = await superAdminTenantService.getPaymentHistory(
    req.params.id,
  );
  res.status(200).json({ status: "success", data: { payments } });
});

// ============================================================================
// TENANT USERS
// ============================================================================
export const getTenantUsers = catchAsync(async (req, res) => {
  const users = await superAdminTenantService.getTenantUsers(req.params.id);
  res.status(200).json({ status: "success", data: { users } });
});

export const getTenantRoles = catchAsync(async (req, res) => {
  const roles = await superAdminTenantService.getTenantRoles(req.params.id);
  res.status(200).json({ status: "success", data: { roles } });
});

export const createTenantUser = catchAsync(async (req, res) => {
  const user = await superAdminTenantService.createTenantUser(req.params.id, req.body);
  res.status(201).json({ status: "success", data: { user } });
});

export const updateTenantUser = catchAsync(async (req, res) => {
  const user = await superAdminTenantService.updateTenantUser(req.params.id, req.params.userId, req.body);
  res.status(200).json({ status: "success", data: { user } });
});

export const deleteTenantUser = catchAsync(async (req, res) => {
  await superAdminTenantService.deleteTenantUser(req.params.id, req.params.userId);
  res.status(204).send();
});

// ============================================================================
// GLOBAL CORS MANAGEMENT
// ============================================================================
export const getGlobalCors = catchAsync(async (req, res) => {
  const data = await superAdminTenantService.getGlobalCors();
  res.status(200).json({ status: "success", data });
});

export const updateGlobalCors = catchAsync(async (req, res) => {
  const { origins } = req.body;
  if (!Array.isArray(origins)) {
    return res.status(400).json({ status: "fail", message: "origins must be an array." });
  }
  const data = await superAdminTenantService.updateGlobalCors(origins);
  res.status(200).json({ status: "success", data });
});

// ============================================================================
// IMPERSONATION
// ============================================================================
export const impersonate = catchAsync(async (req, res) => {
  const { targetUserId } = req.body;
  const data = await superAdminTenantService.generateImpersonationToken(
    req.superAdmin.superAdminId,
    req.params.id,
    targetUserId,
  );

  res.cookie("accessToken", data.impersonationToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000,
  });

  res.status(200).json({ status: "success", data });
});

// ============================================================================
// AUDIT LOG
// ============================================================================
export const getAuditLog = catchAsync(async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const data = await superAdminTenantService.getAuditLog(
    parseInt(page),
    parseInt(limit),
  );
  res.status(200).json({ status: "success", data });
});

// ============================================================================
// CONTACT INQUIRIES — public form submissions, surfaced to super admins
// ============================================================================
export const listInquiries = catchAsync(async (req, res) => {
  const data = await superAdminInquiryService.listInquiries(req.query);
  res.status(200).json({ status: "success", data });
});

export const getInquiryStats = catchAsync(async (req, res) => {
  const data = await superAdminInquiryService.inquiryStats();
  res.status(200).json({ status: "success", data });
});

export const getInquiry = catchAsync(async (req, res) => {
  const inquiry = await superAdminInquiryService.getInquiry(req.params.id);
  res.status(200).json({ status: "success", data: { inquiry } });
});

export const updateInquiry = catchAsync(async (req, res) => {
  const inquiry = await superAdminInquiryService.updateInquiry(
    req.params.id,
    req.body,
  );
  res.status(200).json({ status: "success", data: { inquiry } });
});

export const deleteInquiry = catchAsync(async (req, res) => {
  await superAdminInquiryService.deleteInquiry(req.params.id);
  res.status(204).send();
});
