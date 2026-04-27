import bcrypt from "bcrypt";
import { Op } from "sequelize";
import AppError from "../utils/AppError.js";

// ==========================================
// GENERAL USER ADMINISTRATION
// ==========================================

export const getAllUsers = async (models) => {
  return await models.User.findAll({
    attributes: { exclude: ["password_hash"] },
    include: [
      {
        model: models.Role,
        attributes: ["role_id", "role_name"],
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
  await user.save(); // Fixed the 'save();a' typo!
  return user;
};

export const assignUserRoles = async (models, userId, roleIds) => {
  const user = await models.User.findByPk(userId);
  if (!user) throw new AppError("User not found.", 404);

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
  // 1. Fetch active users (You can join Role here if you want to strictly filter by 'Technician' role)
  const users = await models.User.findAll({
    where: { is_active: 1 },
    attributes: { exclude: ["password_hash"] },
    include: [
      {
        model: models.Role,
        where: { role_name: "Technician" }, // <-- THIS IS THE FILTER!
        attributes: [], // We don't need to send the role data itself, just filter by it
        through: { attributes: [] },
      },
    ],
  });

  // 2. Fetch active defect tickets
  const activeDefects = await models.DefectLog.findAll({
    where: {
      repair_status: {
        [Op.in]: ["In Repair", "Pending Assignment", "Partially Resolved"],
      },
      assigned_technician_id: { [Op.not]: null },
    },
    attributes: ["assigned_technician_id", "pending_quantity"],
  });

  // 3. Map workload
  const roster = users.map((user) => {
    const techId = user.user_id;
    const myTickets = activeDefects.filter(
      (d) => d.assigned_technician_id === techId,
    );

    return {
      ...user.toJSON(),
      active_tickets: myTickets.length,
      total_items_pending: myTickets.reduce(
        (sum, ticket) => sum + ticket.pending_quantity,
        0,
      ),
    };
  });

  return roster.sort((a, b) => a.active_tickets - b.active_tickets);
};

export const createTechnician = async (models, payload) => {
  const {
    username,
    email,
    nic_no,
    password,
    first_name,
    last_name,
    phone_number,
    address_line1,
  } = payload;

  return await models.sequelize.transaction(async (t) => {
    // 1. Check Duplicates
    const existingUser = await models.User.findOne({
      where: { [Op.or]: [{ email }, { username }, { nic_no }] },
      transaction: t,
    });

    if (existingUser) {
      if (existingUser.email === email)
        throw new AppError("Email already in use.", 400);
      if (existingUser.username === username)
        throw new AppError("Username already taken.", 400);
      if (existingUser.nic_no === nic_no)
        throw new AppError("NIC number already registered.", 400);
    }

    // 2. Hash Password
    const password_hash = await bcrypt.hash(password || "Default@123", 12);

    // 3. Create User
    const newUser = await models.User.create(
      {
        username,
        email,
        nic_no,
        password_hash,
        first_name,
        last_name,
        phone_number,
        address_line1,
        is_active: 1,
      },
      { transaction: t },
    );

    // 4. Assign Technician Role
    const [techRole] = await models.Role.findOrCreate({
      where: { role_name: "Technician" },
      defaults: {
        description: "Repair and Maintenance Worker",
        is_system_default: 0,
      },
      transaction: t,
    });

    await newUser.addRole(techRole, { transaction: t });

    const userData = newUser.toJSON();
    delete userData.password_hash;
    return userData;
  });
};

export const updateTechnician = async (models, userId, payload) => {
  const user = await models.User.findByPk(userId);
  if (!user) throw new AppError("Technician not found.", 404);

  // If they are changing their email or NIC, check for collisions
  if (payload.email && payload.email !== user.email) {
    const emailExists = await models.User.findOne({
      where: { email: payload.email },
    });
    if (emailExists)
      throw new AppError("Email already in use by another user.", 400);
  }
  if (payload.nic_no && payload.nic_no !== user.nic_no) {
    const nicExists = await models.User.findOne({
      where: { nic_no: payload.nic_no },
    });
    if (nicExists) throw new AppError("NIC number already in use.", 400);
  }

  // Update the user
  await user.update(payload);

  const userData = user.toJSON();
  delete userData.password_hash;
  return userData;
};
