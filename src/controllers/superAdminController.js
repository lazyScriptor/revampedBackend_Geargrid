import * as superAdminAuthService from "../services/superAdminAuthService.js";
import * as superAdminTenantService from "../services/superAdminTenantService.js";
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
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
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
export const getAllTenants = catchAsync(async (req, res) => {
  const tenants = await superAdminTenantService.getAllTenants();
  res.status(200).json({ status: "success", data: { tenants } });
});

export const getTenantDetails = catchAsync(async (req, res) => {
  const data = await superAdminTenantService.getTenantDetails(req.params.id);
  res.status(200).json({ status: "success", data });
});

export const updateTenant = catchAsync(async (req, res) => {
  const tenant = await superAdminTenantService.updateTenantSubscription(
    req.params.id,
    req.body,
  );
  res.status(200).json({ status: "success", data: { tenant } });
});

export const suspendTenant = catchAsync(async (req, res) => {
  const tenant = await superAdminTenantService.suspendTenant(req.params.id);
  res
    .status(200)
    .json({ status: "success", message: "Tenant suspended.", data: { tenant } });
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

  // Set the impersonation token as the user's accessToken cookie
  res.cookie("accessToken", data.impersonationToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000, // 15 minutes
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
