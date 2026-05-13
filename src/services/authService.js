import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { masterSequelize, getTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { getMasterModels } from "../models/master/index.js";
import AppError from "../utils/AppError.js";
import { QueryTypes } from "sequelize";
import crypto from "crypto";

export const loginUser = async (email, password) => {
  // 1. Query the MASTER Database
  const globalUsers = await masterSequelize.query(
    `SELECT gu.*, t.db_name, t.db_host, t.db_user, t.encrypted_db_pass 
     FROM GLOBAL_USERS gu 
     JOIN TENANTS t ON gu.target_tenant_id = t.tenant_id 
     WHERE gu.email = :email`,
    {
      replacements: { email: email },
      type: QueryTypes.SELECT,
    },
  );

  if (globalUsers.length === 0) {
    throw new AppError("Invalid email or account does not exist.", 401);
  }

  const globalUser = globalUsers[0];

  const isPasswordValid = await bcrypt.compare(
    password,
    globalUser.password_hash,
  );
  if (!isPasswordValid) {
    throw new AppError("Invalid password.", 401);
  }

  // 2. Connect to the user's specific TENANT Database
  const tenantConnection = await getTenantConnection(
    globalUser.db_name,
    globalUser.db_user,
    globalUser.encrypted_db_pass,
    globalUser.db_host,
  );

  // 2b. Check tenant suspension status
  try {
    const { Tenant } = getMasterModels();
    const tenant = await Tenant.findOne({ where: { db_name: globalUser.db_name } });
    if (tenant && tenant.subscription_status === "Suspended") {
      throw new AppError(
        "Your organization's account has been suspended. Contact support.",
        403,
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    // If master models aren't initialized yet, skip check
  }

  // ✅ ADDED: Extract the Permission model as well
  const { User, Role, Permission, TenantConfig, UserPermissionOverride } =
    initTenantModels(tenantConnection);

  const configData = await TenantConfig.findOne({
    where: { status: 1 },
    order: [["updatedAt", "DESC"]],
  });

  // 3. Get user roles AND PERMISSIONS from Tenant DB
  const tenantUser = await User.findOne({
    where: { email: globalUser.email, is_active: true },
    include: [
      {
        model: Role,
        attributes: ["role_name", "hierarchy_level"],
        through: { attributes: [] },
        // ✅ ADDED: Nested include to fetch permissions for each role
        include: [
          {
            model: Permission,
            attributes: ["permission_code"],
            through: { attributes: [] },
          },
        ],
      },
    ],
  });

  if (!tenantUser) {
    throw new AppError(
      "Account is disabled or missing in the tenant database.",
      403,
    );
  }

  // 4. Extract Roles and Permissions into clean arrays
  const roles = tenantUser.Roles.map((role) => role.role_name);

  if (roles.length === 0) {
    throw new AppError(
      "Your account has no assigned roles. Contact an admin.",
      403,
    );
  }

  let maxHierarchy = 0;
  tenantUser.Roles.forEach((role) => {
    if (role.hierarchy_level > maxHierarchy) {
      maxHierarchy = role.hierarchy_level;
    }
  });

  // ✅ ADDED: Flatten and deduplicate permissions using a Set
  const permissionSet = new Set();
  tenantUser.Roles.forEach((role) => {
    if (role.Permissions) {
      role.Permissions.forEach((perm) => {
        permissionSet.add(perm.permission_code);
      });
    }
  });
  const permissions = Array.from(permissionSet); // e.g., ['view_dashboard', 'view_equipment']

  // ✅ ADDED: Apply user-level overrides (grants/revokes)
  const effectivePerms = new Set(permissionSet);
  try {
    const overrides = await UserPermissionOverride.findAll({
      where: { user_id: tenantUser.user_id },
      include: [
        { model: Permission, attributes: ["permission_code"] },
      ],
    });
    for (const o of overrides) {
      const code = o.Permission?.permission_code;
      if (!code) continue;
      if (o.grant_type === "grant") effectivePerms.add(code);
      else if (o.grant_type === "revoke") effectivePerms.delete(code);
    }
  } catch (e) {
    // UserPermissionOverride table might not exist yet — gracefully skip
  }
  const effectivePermissions = Array.from(effectivePerms);

  // 5. Generate Multi-Tenant JWTs
  const tokenPayload = {
    userId: tenantUser.user_id,
    username: tenantUser.username,
    roles: roles, // We keep Roles in the JWT...
    roleHierarchyLevel: maxHierarchy,
    // Note: We intentionally DO NOT put `permissions` in the JWT payload.
    // An admin might have 50 permissions, which would bloat the token size and slow down headers.
    warehouseId: tenantUser.warehouse_id,
    tenantDbName: globalUser.db_name,
  };

  const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });
  const refreshToken = jwt.sign(tokenPayload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: "7d",
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: tenantUser.user_id,
      username: tenantUser.username,
      email: tenantUser.email,
      roles: roles,
      warehouseId: tenantUser.warehouse_id,
      configData: configData,
      permissions: effectivePermissions, // ✅ Now includes user-level overrides
    },
  };
};

// ... existing loginUser function ...

export const registerUser = async (
  tenantId,
  email,
  username,
  password,
  firstName,
  lastName,
  nicNo,
) => {
  // 1. Check if the tenant exists in the Master DB
  const tenants = await masterSequelize.query(
    `SELECT * FROM TENANTS WHERE tenant_id = :tenantId`,
    { replacements: { tenantId }, type: QueryTypes.SELECT },
  );

  if (tenants.length === 0) {
    throw new AppError("Tenant business not found.", 404);
  }
  const tenant = tenants[0];

  // 2. Hash the password
  const hashedPassword = await bcrypt.hash(password, 12);

  // 3. Connect to the specific TENANT DB FIRST
  const tenantConnection = await getTenantConnection(
    tenant.db_name,
    tenant.db_user,
    tenant.encrypted_db_pass,
    tenant.db_host,
  );
  const { User, Role } = initTenantModels(tenantConnection);

  // 4. Create the user in the TENANT DB
  // We do NOT pass user_id so MySQL handles the auto-increment automatically
  const newUser = await User.create({
    username,
    email,
    password_hash: hashedPassword,
    first_name: firstName,
    last_name: lastName,
    nic_no: nicNo,
    is_active: true,
  });

  // 5. Retrieve the newly generated Auto-Increment ID
  const newUserId = newUser.user_id;

  // 6. Insert into MASTER DB (GLOBAL_USERS) using the generated ID
  await masterSequelize.query(
    `INSERT INTO GLOBAL_USERS (global_user_id, email, password_hash, target_tenant_id) 
     VALUES (:id, :email, :pass, :tenantId)`,
    {
      replacements: { id: newUserId, email, pass: hashedPassword, tenantId },
    },
  );

  // 7. Assign them an 'admin' role (creates the role if it doesn't exist yet)
  const [adminRole] = await Role.findOrCreate({
    where: { role_name: "admin" },
    defaults: { description: "System Administrator", is_system_default: true },
  });

  await newUser.addRole(adminRole);

  return newUser;
};
