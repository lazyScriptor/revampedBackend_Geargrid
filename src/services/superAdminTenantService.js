import jwt from "jsonwebtoken";
import { getMasterModels } from "../models/master/index.js";
import { getTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import AppError from "../utils/AppError.js";
import { updateCorsOrigins } from "../config/cors-config.js";

const SUPER_ADMIN_SECRET =
  process.env.SUPER_ADMIN_JWT_SECRET || process.env.JWT_SECRET;

// ============================================================================
// TENANT LISTING
// ============================================================================
export const getAllTenants = async () => {
  const { Tenant, GlobalUser } = getMasterModels();

  const tenants = await Tenant.findAll({
    include: [{ model: GlobalUser, attributes: ["global_user_id", "email"] }],
    order: [["createdAt", "ASC"]],
  });

  return tenants.map((t) => {
    const plain = t.get({ plain: true });
    plain.userCount = plain.GlobalUsers?.length || 0;
    delete plain.GlobalUsers;
    // Redact DB credentials from list view
    delete plain.encrypted_db_pass;
    return plain;
  });
};

export const getTenantDetails = async (tenantId) => {
  const { Tenant, GlobalUser } = getMasterModels();

  const tenant = await Tenant.findByPk(tenantId, {
    include: [{ model: GlobalUser, attributes: ["global_user_id", "email"] }],
  });

  if (!tenant) throw new AppError("Tenant not found.", 404);

  const plain = tenant.get({ plain: true });
  delete plain.encrypted_db_pass;

  let tenantConfig = null;
  try {
    const conn = await getTenantConnection(
      tenant.db_name,
      tenant.db_user,
      tenant.encrypted_db_pass,
      tenant.db_host,
    );
    const models = initTenantModels(conn);
    tenantConfig = await models.TenantConfig.findOne({ raw: true });
  } catch {
    // Tenant DB might be unreachable
  }

  return { tenant: plain, tenantConfig };
};

// ============================================================================
// TENANT CONFIG (full update — all configurable fields)
// ============================================================================
const UPDATABLE_FIELDS = [
  "subscription_status",
  "tier",
  "max_users",
  "feature_flags",
  "display_name",
  "contact_email",
  "contact_phone",
  "monthly_rate",
  "next_billing_date",
  "cors_whitelist",
  "branding",
  "internal_notes",
];

export const updateTenantConfig = async (tenantId, updates) => {
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError("Tenant not found.", 404);

  const filtered = {};
  for (const key of UPDATABLE_FIELDS) {
    if (updates[key] !== undefined) filtered[key] = updates[key];
  }

  await tenant.update(filtered);
  const plain = tenant.get({ plain: true });
  delete plain.encrypted_db_pass;
  return plain;
};

// Legacy alias — still used by PATCH /tenants/:id
export const updateTenantSubscription = updateTenantConfig;

// ============================================================================
// STATUS CONTROLS
// ============================================================================
export const suspendTenant = async (tenantId) =>
  updateTenantConfig(tenantId, { subscription_status: "Suspended" });

export const activateTenant = async (tenantId) =>
  updateTenantConfig(tenantId, { subscription_status: "Active" });

export const markTenantOverdue = async (tenantId) =>
  updateTenantConfig(tenantId, { subscription_status: "Overdue" });

// ============================================================================
// BILLING / PAYMENT HISTORY
// ============================================================================
export const recordPayment = async (tenantId, paymentData) => {
  const { Tenant, TenantSubscription } = getMasterModels();
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError("Tenant not found.", 404);

  const payment = await TenantSubscription.create({
    tenant_id: tenantId,
    plan_name: paymentData.plan_name || "Monthly",
    amount: paymentData.amount || 0,
    currency: paymentData.currency || "LKR",
    status: paymentData.status || "Paid",
    billing_period_start: paymentData.billing_period_start || null,
    billing_period_end: paymentData.billing_period_end || null,
    paid_at: paymentData.status === "Paid" ? new Date() : null,
    method: paymentData.method || null,
    reference_number: paymentData.reference_number || null,
    notes: paymentData.notes || null,
  });

  // Auto-activate if payment received and tenant was overdue
  if (
    paymentData.status === "Paid" &&
    tenant.subscription_status === "Overdue"
  ) {
    await tenant.update({ subscription_status: "Active" });
  }

  return payment.get({ plain: true });
};

export const getPaymentHistory = async (tenantId) => {
  const { TenantSubscription } = getMasterModels();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError("Tenant not found.", 404);

  const payments = await TenantSubscription.findAll({
    where: { tenant_id: tenantId },
    order: [["createdAt", "DESC"]],
  });
  return payments.map((p) => p.get({ plain: true }));
};

// ============================================================================
// GLOBAL CORS MANAGEMENT
// ============================================================================
export const getGlobalCors = async () => {
  const { PlatformConfig } = getMasterModels();
  const config = await PlatformConfig.findByPk("cors_origins");
  return { origins: config ? config.config_value : [] };
};

export const updateGlobalCors = async (origins) => {
  const { PlatformConfig } = getMasterModels();
  await PlatformConfig.upsert({
    config_key: "cors_origins",
    config_value: origins,
    updatedAt: new Date(),
  });
  // Live-refresh the in-process CORS list (no restart needed)
  updateCorsOrigins(origins);
  return { origins };
};

// ============================================================================
// TENANT USERS (for impersonation picker)
// ============================================================================
export const getTenantUsers = async (tenantId) => {
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError("Tenant not found.", 404);

  const conn = await getTenantConnection(
    tenant.db_name,
    tenant.db_user,
    tenant.encrypted_db_pass,
    tenant.db_host,
  );
  const models = initTenantModels(conn);

  const users = await models.User.findAll({
    attributes: ["user_id", "username", "email", "status"],
    include: [
      {
        model: models.Role,
        attributes: ["role_name"],
        through: { attributes: [] },
      },
    ],
    order: [["user_id", "ASC"]],
  });

  return users.map((u) => ({
    user_id: u.user_id,
    username: u.username,
    email: u.email,
    status: u.status,
    roles: u.Roles?.map((r) => r.role_name) || [],
  }));
};

// ============================================================================
// PLATFORM DASHBOARD KPIs
// ============================================================================
export const getPlatformDashboard = async () => {
  const { Tenant, GlobalUser, TenantSubscription, sequelize } =
    getMasterModels();

  const [
    totalTenants,
    activeTenants,
    suspendedTenants,
    overdueTenants,
    totalGlobalUsers,
    tierBreakdown,
    recentRevenue,
  ] = await Promise.all([
    Tenant.count(),
    Tenant.count({ where: { subscription_status: "Active" } }),
    Tenant.count({ where: { subscription_status: "Suspended" } }),
    Tenant.count({ where: { subscription_status: "Overdue" } }),
    GlobalUser.count(),
    Tenant.findAll({
      attributes: [
        "tier",
        [sequelize.fn("COUNT", sequelize.col("tenant_id")), "count"],
      ],
      group: ["tier"],
      raw: true,
    }),
    TenantSubscription.sum("amount", {
      where: { status: "Paid" },
    }),
  ]);

  return {
    totalTenants,
    activeTenants,
    suspendedTenants,
    overdueTenants,
    totalGlobalUsers,
    tierBreakdown,
    totalRevenuePaid: recentRevenue || 0,
  };
};

// ============================================================================
// IMPERSONATION ENGINE
// ============================================================================
export const generateImpersonationToken = async (
  superAdminId,
  tenantId,
  targetUserId,
) => {
  const { Tenant, AuditLog } = getMasterModels();

  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError("Tenant not found.", 404);

  const conn = await getTenantConnection(
    tenant.db_name,
    tenant.db_user,
    tenant.encrypted_db_pass,
    tenant.db_host,
  );
  const models = initTenantModels(conn);

  const targetUser = await models.User.findByPk(targetUserId, {
    include: [
      {
        model: models.Role,
        attributes: ["role_name"],
        through: { attributes: [] },
      },
    ],
  });

  if (!targetUser) {
    throw new AppError("Target user not found in tenant database.", 404);
  }

  const roles = targetUser.Roles.map((r) => r.role_name);

  const impersonationToken = jwt.sign(
    {
      userId: targetUser.user_id,
      username: targetUser.username,
      roles,
      warehouseId: targetUser.warehouse_id,
      tenantDbName: tenant.db_name,
      isImpersonation: true,
      superAdminId,
    },
    process.env.JWT_SECRET,
    { expiresIn: "15m" },
  );

  await AuditLog.create({
    super_admin_id: superAdminId,
    action: "IMPERSONATION",
    target_tenant_id: tenantId,
    target_user_id: targetUserId,
    metadata: {
      targetUsername: targetUser.username,
      tenantDbName: tenant.db_name,
    },
  });

  return {
    impersonationToken,
    user: {
      id: targetUser.user_id,
      username: targetUser.username,
      email: targetUser.email,
      roles,
    },
    tenantDbName: tenant.db_name,
    expiresIn: "15 minutes",
  };
};

// ============================================================================
// AUDIT LOG
// ============================================================================
export const getAuditLog = async (page = 1, limit = 50) => {
  const { AuditLog, SuperAdmin } = getMasterModels();
  const offset = (page - 1) * limit;

  const { count, rows } = await AuditLog.findAndCountAll({
    include: [
      {
        model: SuperAdmin,
        attributes: ["email", "display_name"],
      },
    ],
    order: [["createdAt", "DESC"]],
    limit,
    offset,
  });

  return { totalItems: count, logs: rows };
};
