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

  return await models.sequelize.transaction(async (t) => {
    // 1. Check Duplicates in Tenant DB
    const existingUser = await models.User.findOne({
      where: { [Op.or]: [{ email }, { username }, { nic_no }] },
      transaction: t,
    });

    if (existingUser) {
      if (existingUser.email === email) throw new AppError("Email already in use.", 400);
      if (existingUser.username === username) throw new AppError("Username already taken.", 400);
      if (existingUser.nic_no === nic_no) throw new AppError("NIC number already registered.", 400);
    }

    // 2. Hash Password
    const password_hash = await bcrypt.hash(password, 12);

    // 3. Create User in Tenant DB
    const newUser = await models.User.create({
      email, username, password_hash, first_name, last_name, nic_no, is_active: true
    }, { transaction: t });

    // 4. Create GlobalUser in Master DB
    const tenantId = await getTenantId(tenantDbName);
    const { GlobalUser } = initMasterModels(masterSequelize);
    
    // Check if global user exists
    const existingGlobal = await GlobalUser.findOne({ where: { email } });
    if (existingGlobal) {
      throw new AppError("Email already registered globally. Cannot use this email.", 400);
    }

    await GlobalUser.create({
      global_user_id: newUser.user_id,
      email: email,
      password_hash: password_hash,
      target_tenant_id: tenantId
    });

    // 5. Assign Roles
    if (role_ids && role_ids.length > 0) {
      await newUser.setRoles(role_ids, { transaction: t });
    }

    const userData = newUser.toJSON();
    delete userData.password_hash;
    return userData;
  });
};

export const updateUser = async (models, userId, payload) => {
  const user = await models.User.findByPk(userId);
  if (!user) throw new AppError("User not found.", 404);

  // If changing email/nic, check duplicates
  if (payload.email && payload.email !== user.email) {
    const emailExists = await models.User.findOne({ where: { email: payload.email } });
    if (emailExists) throw new AppError("Email already in use.", 400);
    
    // Update Master DB
    const { GlobalUser } = initMasterModels(masterSequelize);
    await GlobalUser.update({ email: payload.email }, { where: { email: user.email } });
  }

  if (payload.password) {
    payload.password_hash = await bcrypt.hash(payload.password, 12);
    // Update Master DB
    const { GlobalUser } = initMasterModels(masterSequelize);
    await GlobalUser.update({ password_hash: payload.password_hash }, { where: { email: user.email } });
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

  // Enforce hierarchy
  const roles = await models.Role.findAll({ where: { role_id: roleIds } });
  for (const r of roles) {
    if (reqUserHierarchy <= r.hierarchy_level && reqUserHierarchy !== 100) { // Super Admin has 100 implicitly
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
    where: { is_active: 1 },
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

export const createTechnician = async (models, payload) => {
  // Legacy createTechnician - delegates to enterprise createUser
  // Or keep it unchanged for now, but we just updated the enterprise one.
  return await createUser(models, payload.tenantDbName, payload); // Simplification, need payload.tenantDbName
};

export const updateTechnician = async (models, userId, payload) => {
  return await updateUser(models, userId, payload);
};

