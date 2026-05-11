import jwt from "jsonwebtoken";
import { getMasterModels } from "../models/master/index.js";
import { getTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import AppError from "../utils/AppError.js";
import { QueryTypes } from "sequelize";

const SUPER_ADMIN_SECRET =
  process.env.SUPER_ADMIN_JWT_SECRET || process.env.JWT_SECRET;

// ============================================================================
// TENANT LISTING
// ============================================================================
export const getAllTenants = async () => {
  const { Tenant, GlobalUser, sequelize } = getMasterModels();

  const tenants = await Tenant.findAll({
    include: [
      {
        model: GlobalUser,
        attributes: ["global_user_id", "email"],
      },
    ],
    order: [["tenant_id", "ASC"]],
  });

  // Enrich with user count
  return tenants.map((t) => {
    const plain = t.get({ plain: true });
    plain.userCount = plain.GlobalUsers?.length || 0;
    delete plain.GlobalUsers;
    return plain;
  });
};

export const getTenantDetails = async (tenantId) => {
  const { Tenant, GlobalUser } = getMasterModels();

  const tenant = await Tenant.findByPk(tenantId, {
    include: [{ model: GlobalUser, attributes: ["global_user_id", "email"] }],
  });

  if (!tenant) throw new AppError("Tenant not found.", 404);

  // Try to get tenant config for display name
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
  } catch (e) {
    // Tenant DB might be unreachable — don't crash
  }

  return { tenant: tenant.get({ plain: true }), tenantConfig };
};

// ============================================================================
// TENANT MANAGEMENT
// ============================================================================
export const updateTenantSubscription = async (tenantId, updates) => {
  const { Tenant } = getMasterModels();

  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError("Tenant not found.", 404);

  const allowed = ["subscription_status", "tier", "max_users", "feature_flags"];
  const filteredUpdates = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) filteredUpdates[key] = updates[key];
  }

  await tenant.update(filteredUpdates);
  return tenant.get({ plain: true });
};

export const suspendTenant = async (tenantId) => {
  return updateTenantSubscription(tenantId, {
    subscription_status: "Suspended",
  });
};

// ============================================================================
// PLATFORM DASHBOARD KPIs
// ============================================================================
export const getPlatformDashboard = async () => {
  const { Tenant, GlobalUser, sequelize } = getMasterModels();

  const totalTenants = await Tenant.count();
  const activeTenants = await Tenant.count({
    where: { subscription_status: "Active" },
  });
  const suspendedTenants = await Tenant.count({
    where: { subscription_status: "Suspended" },
  });
  const totalGlobalUsers = await GlobalUser.count();

  // Tier breakdown
  const tierBreakdown = await Tenant.findAll({
    attributes: [
      "tier",
      [sequelize.fn("COUNT", sequelize.col("tenant_id")), "count"],
    ],
    group: ["tier"],
    raw: true,
  });

  return {
    totalTenants,
    activeTenants,
    suspendedTenants,
    totalGlobalUsers,
    tierBreakdown,
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

  // 1. Get tenant connection info
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError("Tenant not found.", 404);

  // 2. Connect to tenant DB and find the target user
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

  // 3. Generate a time-limited impersonation JWT (15 minutes)
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
    process.env.JWT_SECRET, // Uses the TENANT secret so it works with protect middleware
    { expiresIn: "15m" },
  );

  // 4. Audit trail
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
