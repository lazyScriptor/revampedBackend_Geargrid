import bcrypt from "bcrypt";
import { Op, QueryTypes } from "sequelize";
import AppError from "../utils/AppError.js";
import { masterSequelize } from "../config/database.js";
import { initMasterModels } from "../models/master/index.js";

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

  if (!password) throw new AppError("Password is required.", 400);
  if (password.length < 8) throw new AppError("Password must be at least 8 characters.", 400);

  const { GlobalUser } = initMasterModels(masterSequelize);

  // 1. Pre-flight uniqueness checks before any writes
  const orConditions = [{ email }];
  if (username) orConditions.push({ username });
  if (nic_no)   orConditions.push({ nic_no });

  const [existingTenant, existingGlobal, tenantId] = await Promise.all([
    models.User.findOne({ where: { [Op.or]: orConditions } }),
    GlobalUser.findOne({ where: { email } }),
    getTenantId(tenantDbName),
  ]);

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
      { email, username, password_hash, first_name, last_name, nic_no, is_active: true },
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
      global_user_id: newUser.user_id,
      email,
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

  if (payload.email && payload.email !== user.email) {
    const emailExists = await models.User.findOne({ where: { email: payload.email } });
    if (emailExists) throw new AppError("Email already in use.", 400);
    await GlobalUser.update({ email: payload.email }, { where: { email: user.email } });
  }

  if (payload.password) {
    payload.password_hash = await bcrypt.hash(payload.password, 12);
    await GlobalUser.update({ password_hash: payload.password_hash }, { where: { email: user.email } });
    delete payload.password;
  }

  await user.update(payload);

  if (payload.role_ids) {
    await user.setRoles(payload.role_ids);
  }

  const userData = user.toJSON();
  delete userData.password_hash;
  return userData;
};

export const deleteUser = async (models, userId) => {
  const user = await models.User.findByPk(userId);
  if (!user) throw new AppError("User not found.", 404);

  user.is_active = false;
  await user.save();
  return user;
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
