import bcrypt from "bcrypt";
import { Op, QueryTypes } from "sequelize";
import AppError from "../utils/AppError.js";
import { masterSequelize } from "../config/database.js";
import { initMasterModels } from "../models/master/index.js";
import { sendDataPush } from "./devicePushService.js";

// Helper to get tenant ID from db_name
const getTenantId = async (dbName) => {
  const tenants = await masterSequelize.query(
    "SELECT tenant_id FROM TENANTS WHERE db_name = :dbName",
    { replacements: { dbName }, type: QueryTypes.SELECT }
  );
  if (!tenants.length) throw new AppError("Tenant not found", 404);
  return tenants[0].tenant_id;
};

// ==========================================
// ENTERPRISE USER ADMINISTRATION
// ==========================================

export const createUser = async (models, tenantDbName, payload) => {
  const { email, username, password, first_name, last_name, nic_no, role_ids } = payload;

  if (username?.includes("@")) throw new AppError("A username can't contain @.", 400);
  if (!password) throw new AppError("Password is required.", 400);
  if (password.length < 8) throw new AppError("Password must be at least 8 characters.", 400);

  const { GlobalUser } = initMasterModels(masterSequelize);

  // 1. Pre-flight uniqueness checks before any writes
  const orConditions = [{ email }];
  if (username) orConditions.push({ username });
  if (nic_no)   orConditions.push({ nic_no });

  const [existingTenant, existingGlobal, usernameTaken, tenantId] = await Promise.all([
    models.User.findOne({ where: { [Op.or]: orConditions } }),
    GlobalUser.findOne({ where: { email } }),
    username ? GlobalUser.findOne({ where: { username } }) : null,
    getTenantId(tenantDbName),
  ]);
  if (usernameTaken) throw new AppError("Username already taken.", 400);

  if (existingTenant) {
    if (existingTenant.email === email)       throw new AppError("Email already in use.", 400);
    if (existingTenant.username === username) throw new AppError("Username already taken.", 400);
    if (existingTenant.nic_no === nic_no)     throw new AppError("NIC number already registered.", 400);
  }
  if (existingGlobal) {
    throw new AppError("Email already registered globally. Cannot use this email.", 400);
  }

  // 2. Hash password once
  const password_hash = await bcrypt.hash(password, 12);

  // 3. Create tenant user + assign roles inside a transaction
  //    GlobalUser is created AFTER the transaction commits to avoid the
  //    "tenant rolled back but master already committed" split-brain bug.
  const newUser = await models.sequelize.transaction(async (t) => {
    const user = await models.User.create(
      { email, username, password_hash, first_name, last_name, nic_no, is_active: true, must_change_password: true },
      { transaction: t }
    );
    if (role_ids && role_ids.length > 0) {
      await user.setRoles(role_ids, { transaction: t });
    }
    return user;
  });

  // 4. Create GlobalUser now that tenant transaction has committed
  try {
    await GlobalUser.create({
      email,
      username,
      password_hash,
      target_tenant_id: tenantId,
    });
  } catch (globalErr) {
    // Master write failed — compensate by removing the tenant user so
    // the two databases stay in sync.
    try {
      await models.User.destroy({ where: { user_id: newUser.user_id } });
    } catch {
      // Compensation also failed; log for manual repair but rethrow original.
    }
    throw new AppError(
      "User registration failed while writing to the global directory. Please try again.",
      500
    );
  }

  const userData = newUser.toJSON();
  delete userData.password_hash;
  return userData;
};

export const updateUser = async (models, userId, payload) => {
  const user = await models.User.findByPk(userId);
  if (!user) throw new AppError("User not found.", 404);

  const { GlobalUser } = initMasterModels(masterSequelize);

  const globalUpdates = {};
  if (payload.email && payload.email !== user.email) {
    const emailExists = await models.User.findOne({ where: { email: payload.email } });
    if (emailExists) throw new AppError("Email already in use.", 400);
    globalUpdates.email = payload.email;
  }

  if (payload.username && payload.username !== user.username) {
    if (payload.username.includes("@")) throw new AppError("A username can't contain @.", 400);
    const taken = await GlobalUser.findOne({ where: { username: payload.username } });
    if (taken && taken.email !== user.email) throw new AppError("Username already taken.", 400);
    globalUpdates.username = payload.username;
  }

  if (payload.password) {
    payload.password_hash = await bcrypt.hash(payload.password, 12);
    globalUpdates.password_hash = payload.password_hash;
    // An admin set it, so it is temporary: the user chooses their own at next login.
    payload.must_change_password = true;
    delete payload.password;
  }

  if (Object.keys(globalUpdates).length > 0) {
    await GlobalUser.update(globalUpdates, { where: { email: user.email } });
  }

  await user.update(payload);

  if (payload.is_active === false) {
    await suspendUserDevices(models, user.user_id);
  }

  if (payload.role_ids) {
    await user.setRoles(payload.role_ids);
    await wipeBriefCacheIfCallsViewRemoved(models, user.user_id);
  }

  const userData = user.toJSON();
  delete userData.password_hash;
  return userData;
};

export const deleteUser = async (models, userId) => {
  const user = await models.User.findByPk(userId, {
    include: [{ model: models.Role, attributes: ["hierarchy_level"] }],
  });
  if (!user) throw new AppError("User not found.", 404);

  // Check if target user is an administrator
  const isAdmin = user.Roles?.some((r) => Number(r.hierarchy_level) >= 100);
  if (isAdmin) {
    const otherAdmin = await models.User.findOne({
      where: {
        user_id: { [Op.ne]: userId },
        is_active: true,
      },
      include: [
        {
          model: models.Role,
          where: { hierarchy_level: { [Op.gte]: 100 } },
          attributes: ["role_id"],
        },
      ],
    });
    if (!otherAdmin) {
      throw new AppError("Cannot deactivate the only active administrator of the company.", 400);
    }
  }

  user.is_active = false;
  await user.save();
  await revokeUserDevices(models, user.user_id);
  return user;
};

/**
 * Permanently removes an already-deactivated user so they stop counting against the shop.
 * Users with invoice/payment/expense history are kept on record (cannot log in) so old records
 * keep their name; the response says which happened.
 */
export const permanentlyDeleteUser = async (models, userId) => {
  const user = await models.User.findByPk(userId);
  if (!user) throw new AppError("User not found.", 404);
  if (user.is_active) throw new AppError("Deactivate this user before removing them permanently.", 400);

  await revokeUserDevices(models, user.user_id);

  const where = (field) => ({ where: { [field]: user.user_id } });
  const history = (
    await Promise.all([
      models.Invoice.unscoped().count(where("issued_by_user_id")),
      models.Payment.count(where("received_by_user_id")),
      models.Expense.count(where("recorded_by_user_id")),
      models.InvoiceTrace.count(where("actor_user_id")),
    ])
  ).reduce((sum, n) => sum + n, 0);

  let removed = false;
  if (history === 0) {
    try {
      await user.setRoles([]);
      await user.destroy();
      removed = true;
    } catch (err) {
      if (err?.name !== "SequelizeForeignKeyConstraintError") throw err;
    }
  }

  if (removed) {
    // Free the login (email/username) for reuse.
    const { GlobalUser } = initMasterModels(masterSequelize);
    await GlobalUser.destroy({ where: { email: user.email } });
  }
  return { removed, archived: !removed };
};

export const getAllUsers = async (models, showInactive = false) => {
  const whereClause = showInactive ? {} : { is_active: true };
  return await models.User.findAll({
    where: whereClause,
    attributes: { exclude: ["password_hash"] },
    include: [
      {
        model: models.Role,
        attributes: ["role_id", "role_name", "hierarchy_level"],
        through: { attributes: [] },
      },
      {
        model: models.Warehouse,
        attributes: ["warehouse_id", "location_name"],
      },
    ],
  });
};

export const updateUserStatus = async (models, userId, isActive) => {
  const user = await models.User.findByPk(userId);
  if (!user) throw new AppError("User not found.", 404);

  user.is_active = isActive;
  await user.save();
  if (!isActive) {
    await suspendUserDevices(models, user.user_id);
  }
  return user;
};

export const assignUserRoles = async (models, userId, roleIds, reqUserHierarchy = 0) => {
  const user = await models.User.findByPk(userId);
  if (!user) throw new AppError("User not found.", 404);

  const roles = await models.Role.findAll({ where: { role_id: roleIds } });
  for (const r of roles) {
    if (reqUserHierarchy <= r.hierarchy_level && reqUserHierarchy !== 100) {
      throw new AppError("You cannot assign a role equal to or higher than your own hierarchy level.", 403);
    }
  }

  await user.setRoles(roleIds);
  await wipeBriefCacheIfCallsViewRemoved(models, userId);

  return await models.User.findByPk(userId, {
    attributes: { exclude: ["password_hash"] },
    include: [{ model: models.Role, attributes: ["role_name"] }],
  });
};

// ==========================================
// ENTERPRISE TECHNICIAN WORKFORCE
// ==========================================

export const getTechniciansWithWorkload = async (models) => {
  const users = await models.User.findAll({
    attributes: { exclude: ["password_hash"] },
    include: [
      {
        model: models.Role,
        where: { role_name: "Technician" },
        attributes: [],
        through: { attributes: [] },
      },
    ],
  });

  const activeDefects = await models.DefectLog.findAll({
    where: {
      repair_status: { [Op.in]: ["In Repair", "Pending Assignment", "Partially Resolved"] },
      assigned_technician_id: { [Op.not]: null },
    },
    attributes: ["assigned_technician_id", "pending_quantity"],
  });

  const roster = users.map((user) => {
    const techId = user.user_id;
    const myTickets = activeDefects.filter((d) => d.assigned_technician_id === techId);
    return {
      ...user.toJSON(),
      active_tickets: myTickets.length,
      total_items_pending: myTickets.reduce((sum, ticket) => sum + ticket.pending_quantity, 0),
    };
  });

  return roster.sort((a, b) => a.active_tickets - b.active_tickets);
};

export const createTechnician = async (models, tenantDbName, payload) => {
  // Ensure the Technician role exists (find or create it)
  const [technicianRole] = await models.Role.findOrCreate({
    where: { role_name: "Technician" },
    defaults: {
      description: "Field repair technician",
      hierarchy_level: 10,
      is_system_default: false,
      is_active: true,
    },
  });

  // Inject the Technician role id so createUser assigns it automatically
  const payloadWithRole = {
    ...payload,
    role_ids: [technicianRole.role_id],
  };

  return await createUser(models, tenantDbName, payloadWithRole);
};

export const updateTechnician = async (models, userId, payload) => {
  return await updateUser(models, userId, payload);
};

/** Details an admin needs to hand a reset code to a staff member. Never for someone above them. */
export const getUserForAdminReset = async (models, userId, actor) => {
  const user = await models.User.findByPk(userId, {
    attributes: ["user_id", "email", "username", "first_name", "phone_number", "is_active"],
    include: [{ model: models.Role, attributes: ["hierarchy_level"] }],
  });
  if (!user) throw new AppError("User not found.", 404);
  if (!user.is_active) throw new AppError("This user is deactivated. Activate them first.", 400);
  if (Number(actor?.userId) === Number(userId)) throw new AppError("Use Forgot password or your profile to change your own password.", 400);
  const theirLevel = Math.max(0, ...(user.Roles ?? []).map((r) => Number(r.hierarchy_level) || 0));
  if (actor && theirLevel > (Number(actor.roleHierarchyLevel) || 0)) {
    throw new AppError("You can't reset the password of someone with a higher role.", 403);
  }
  return user;
};

/** Determine if a User instance (with Roles loaded) is a tenant administrator (hierarchy_level >= 100). */
export const isUserAdmin = (user) => {
  if (!user || user.is_active === false) return false;
  const roles = Array.isArray(user.Roles) ? user.Roles : [];
  return roles.some(
    (role) => role && role.is_active !== false && Number(role.hierarchy_level) >= 100,
  );
};

/**
 * Check whether an active user holds a given RBAC permission code via roles or
 * per-user overrides (A-04). Admins (hierarchy_level >= 100) hold every permission.
 */
export const userHasPermission = async (models, user, permissionCode) => {
  if (!user || user.is_active === false) return false;
  if (isUserAdmin(user)) return true;

  const effective = new Set();
  const roles = Array.isArray(user.Roles) ? user.Roles : [];
  for (const role of roles) {
    if (!role || role.is_active === false) continue;
    for (const perm of role.Permissions || []) {
      if (perm?.permission_code) effective.add(perm.permission_code);
    }
  }

  if (models?.UserPermissionOverride?.findAll && user.user_id) {
    const overrides = await models.UserPermissionOverride.findAll({
      where: { user_id: user.user_id },
      include: models.Permission
        ? [{ model: models.Permission, attributes: ["permission_code"] }]
        : [],
    });
    for (const override of overrides || []) {
      const code = override.Permission?.permission_code;
      if (!code) continue;
      if (override.grant_type === "grant") {
        effective.add(code);
      } else if (override.grant_type === "revoke") {
        effective.delete(code);
      }
    }
  }

  return effective.has(permissionCode);
};

/**
 * Suspend all ACTIVE/PENDING devices belonging to a deactivated user (Part B):
 * clears brief sync watermark, pushes device_suspended, and writes audit log.
 */
export const suspendUserDevices = async (models, userId, actorUserId = null, reason = "user_deactivated") => {
  if (!models?.OperatorDevice?.findAll || !userId) return 0;

  const devices = await models.OperatorDevice.findAll({
    where: { user_id: userId },
  });
  const activeDevices = (devices || []).filter(
    (d) => (d.status || "ACTIVE") !== "REVOKED" && d.status !== "SUSPENDED",
  );
  if (activeDevices.length === 0) return 0;

  for (const device of activeDevices) {
    if (typeof device.update === "function") {
      await device.update({ status: "SUSPENDED", briefs_synced_at: null });
    }
    if (models.DeviceAuditLog?.create) {
      await models.DeviceAuditLog.create({
        operator_device_id: device.operator_device_id,
        actor_user_id: actorUserId,
        action: "suspended",
        detail: { reason },
      }).catch(() => {});
    }
    if (device.push_token) {
      await sendDataPush(device, { type: "device_suspended" }).catch(() => {});
    }
  }

  return activeDevices.length;
};

/**
 * Revoke all paired devices belonging to a deleted/archived user (A-03 / B.4):
 * wipes synced phone contacts, pushes a silent device_revoked command, and
 * sets status = REVOKED while clearing tokens so cached tokens cannot work.
 */
export const revokeUserDevices = async (models, userId, actorUserId = null, reason = "user_deleted") => {
  if (!models?.OperatorDevice?.findAll || !userId) return 0;

  const devices = await models.OperatorDevice.findAll({
    where: { user_id: userId },
  });
  if (!devices || devices.length === 0) return 0;

  const deviceIds = devices.map((d) => d.operator_device_id).filter(Boolean);
  if (deviceIds.length > 0 && models.PhoneContact?.destroy) {
    await models.PhoneContact.destroy({
      where: { operator_device_id: { [Op.in]: deviceIds } },
    });
  }

  for (const device of devices) {
    if (device.push_token) {
      await sendDataPush(device, { type: "device_revoked" }).catch(() => {});
    }
  }

  const now = new Date();
  const revokePatch = {
    status: "REVOKED",
    revoked_at: now,
    token_hash: null,
    prev_token_hash: null,
    prev_token_expires_at: null,
    push_token: null,
    push_token_updated_at: now,
    contact_sync_enabled: false,
    contact_sync_mode: "off",
    briefs_synced_at: null,
  };
  if (models.OperatorDevice.update) {
    await models.OperatorDevice.update(revokePatch, {
      where: { operator_device_id: { [Op.in]: deviceIds } },
    });
  } else {
    for (const device of devices) {
      if (typeof device.update === "function") {
        await device.update(revokePatch);
      }
    }
  }

  if (models.DeviceAuditLog?.create) {
    for (const deviceId of deviceIds) {
      await models.DeviceAuditLog.create({
        operator_device_id: deviceId,
        actor_user_id: actorUserId,
        action: "revoked",
        detail: { reason },
      }).catch(() => {});
    }
  }

  return devices.length;
};

/**
 * Send a silent wipe_cache push to all user's devices if calls:view permission is removed (A-04).
 */
export const wipeBriefCacheIfCallsViewRemoved = async (models, userId) => {
  if (!models?.User?.findByPk || !models?.OperatorDevice?.findAll || !userId) return 0;
  const roleInclude = models.Role
    ? [
        {
          model: models.Role,
          attributes: ["role_id", "role_name", "hierarchy_level", "is_active"],
          through: { attributes: [] },
          ...(models.Permission
            ? {
                include: [
                  {
                    model: models.Permission,
                    attributes: ["permission_code"],
                    through: { attributes: [] },
                  },
                ],
              }
            : {}),
        },
      ]
    : [];
  const freshUser = await models.User.findByPk(userId, { include: roleInclude });
  if (!freshUser || freshUser.is_active === false) {
    return revokeUserDevices(models, userId);
  }
  const canViewCalls = await userHasPermission(models, freshUser, "calls:view");
  if (canViewCalls) return 0;
  const devices = await models.OperatorDevice.findAll({ where: { user_id: userId } });
  let pushed = 0;
  for (const device of devices || []) {
    if (device.push_token) {
      await sendDataPush(device, { type: "wipe_cache" }).catch(() => {});
      pushed += 1;
    }
  }
  return pushed;
};

/** Return user_ids of all active administrators in the tenant. */
export const listAdminUserIds = async (models) => {
  if (!models?.User) return [];
  const users = await models.User.findAll({
    where: { is_active: true },
    attributes: ["user_id", "is_active"],
    include: models.Role
      ? [
          {
            model: models.Role,
            attributes: ["role_id", "role_name", "hierarchy_level", "is_active"],
            through: { attributes: [] },
          },
        ]
      : [],
  });
  return users.filter(isUserAdmin).map((u) => u.user_id);
};
