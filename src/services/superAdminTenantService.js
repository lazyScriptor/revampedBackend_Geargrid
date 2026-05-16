import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { getMasterModels } from "../models/master/index.js";
import { masterSequelize, getTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import AppError from "../utils/AppError.js";
import { updateCorsOrigins } from "../config/cors-config.js";

// Full permission catalog — mirrors seedPermissions.js
const PERMISSION_CATALOG = [
  { permission_code: "dashboard:view", module_name: "Dashboard", description: "View the main dashboard" },
  { permission_code: "invoice:create", module_name: "Invoices", description: "Create new invoices" },
  { permission_code: "invoice:view", module_name: "Invoices", description: "View invoices" },
  { permission_code: "invoice:edit", module_name: "Invoices", description: "Edit invoices" },
  { permission_code: "invoice:delete", module_name: "Invoices", description: "Delete invoices" },
  { permission_code: "invoice:field:edit_discount", module_name: "Invoices", description: "Edit invoice discount field" },
  { permission_code: "invoice:field:edit_transport_fee", module_name: "Invoices", description: "Edit transport fee field" },
  { permission_code: "invoice:action:process_return", module_name: "Invoices", description: "Process equipment returns" },
  { permission_code: "invoice:action:add_payment", module_name: "Invoices", description: "Record payment against invoice" },
  { permission_code: "invoice:action:send_reminder", module_name: "Invoices", description: "Send payment reminder emails" },
  { permission_code: "equipment:create", module_name: "Equipment", description: "Add new equipment" },
  { permission_code: "equipment:view", module_name: "Equipment", description: "View equipment list" },
  { permission_code: "equipment:edit", module_name: "Equipment", description: "Edit equipment details" },
  { permission_code: "equipment:delete", module_name: "Equipment", description: "Delete equipment" },
  { permission_code: "equipment:action:bulk_import", module_name: "Equipment", description: "Bulk import via CSV" },
  { permission_code: "category:create", module_name: "Categories", description: "Create equipment categories" },
  { permission_code: "category:view", module_name: "Categories", description: "View categories" },
  { permission_code: "category:edit", module_name: "Categories", description: "Edit categories" },
  { permission_code: "category:delete", module_name: "Categories", description: "Delete categories" },
  { permission_code: "customer:create", module_name: "Customers", description: "Add new customers" },
  { permission_code: "customer:view", module_name: "Customers", description: "View customer list" },
  { permission_code: "customer:edit", module_name: "Customers", description: "Edit customer details" },
  { permission_code: "customer:delete", module_name: "Customers", description: "Delete customers" },
  { permission_code: "customer:action:bulk_import", module_name: "Customers", description: "Bulk import customers" },
  { permission_code: "accounting:view", module_name: "Accounting", description: "View accounting dashboard" },
  { permission_code: "accounting:export_pdf", module_name: "Accounting", description: "Export reports as PDF" },
  { permission_code: "accounting:export_excel", module_name: "Accounting", description: "Export reports as Excel" },
  { permission_code: "accounting:manage_expenses", module_name: "Accounting", description: "Create/edit/delete expenses" },
  { permission_code: "defect:create", module_name: "Maintenance", description: "Report new defects" },
  { permission_code: "defect:view", module_name: "Maintenance", description: "View defect log" },
  { permission_code: "defect:assign_technician", module_name: "Maintenance", description: "Assign technician to defect" },
  { permission_code: "defect:resolve", module_name: "Maintenance", description: "Mark defect as resolved" },
  { permission_code: "warehouse:view", module_name: "Warehouses", description: "View warehouses" },
  { permission_code: "warehouse:manage", module_name: "Warehouses", description: "Create/edit/delete warehouses" },
  { permission_code: "data_arena:view", module_name: "Data Arena", description: "View data arena" },
  { permission_code: "data_arena:export", module_name: "Data Arena", description: "Export data" },
  { permission_code: "data_arena:import", module_name: "Data Arena", description: "Import bulk data" },
  { permission_code: "user:view", module_name: "User Management", description: "View users list" },
  { permission_code: "user:create", module_name: "User Management", description: "Create single user" },
  { permission_code: "user:bulk_create", module_name: "User Management", description: "Bulk import users" },
  { permission_code: "user:update", module_name: "User Management", description: "Edit user details" },
  { permission_code: "user:delete", module_name: "User Management", description: "Delete/Deactivate user" },
  { permission_code: "user:bulk_delete", module_name: "User Management", description: "Bulk delete users" },
  { permission_code: "user:assign_role", module_name: "User Management", description: "Assign roles to user" },
  { permission_code: "user:bulk_assign_role", module_name: "User Management", description: "Bulk assign roles" },
  { permission_code: "role:view", module_name: "User Management", description: "View roles list" },
  { permission_code: "role:create", module_name: "User Management", description: "Create new role" },
  { permission_code: "role:bulk_create", module_name: "User Management", description: "Bulk create roles" },
  { permission_code: "role:update", module_name: "User Management", description: "Edit role details" },
  { permission_code: "role:delete", module_name: "User Management", description: "Delete/Deactivate role" },
  { permission_code: "role:bulk_delete", module_name: "User Management", description: "Bulk delete roles" },
  { permission_code: "role:assign_permission", module_name: "User Management", description: "Assign permissions to role" },
  { permission_code: "role:bulk_assign_permission", module_name: "User Management", description: "Bulk assign permissions" },
  { permission_code: "config:view", module_name: "Configuration", description: "View tenant configuration" },
  { permission_code: "config:manage", module_name: "Configuration", description: "Edit tenant configuration" },
  { permission_code: "workforce:view", module_name: "Workforce", description: "View workforce roster" },
  { permission_code: "workforce:manage", module_name: "Workforce", description: "Manage technicians" },
  { permission_code: "rental_history:view", module_name: "Rental History", description: "View rental history" },
  { permission_code: "inventory_permission", module_name: "Legacy", description: "Legacy module-level inventory access" },
];

// ============================================================================
// TENANT LISTING
// ============================================================================
// MySQL stores JSON columns as longtext, and mysql2 sometimes returns them as raw
// strings. Normalize so the frontend can always rely on real objects/arrays.
const JSON_TENANT_FIELDS = ["branding", "feature_flags", "cors_whitelist"];

// Strip object keys that are purely numeric strings — these come from accidental
// `{...stringValue}` spreads in older client code and pollute the JSON column.
const stripCorruptedSpreadKeys = (val) => {
  if (!val || typeof val !== "object" || Array.isArray(val)) return val;
  const cleaned = {};
  for (const k of Object.keys(val)) {
    if (!/^\d+$/.test(k)) cleaned[k] = val[k];
  }
  return cleaned;
};

const normalizeTenant = (plain) => {
  for (const key of JSON_TENANT_FIELDS) {
    let val = plain[key];
    if (typeof val === "string") {
      try { val = JSON.parse(val); } catch { /* leave as-is */ }
    }
    if (key === "branding" || key === "feature_flags") {
      val = stripCorruptedSpreadKeys(val);
    }
    plain[key] = val;
  }
  return plain;
};

// Same cleanup applied to incoming PATCH payloads so a client that still sends
// a polluted object can't write the bad data back to the DB.
const sanitizeUpdatePayload = (updates) => {
  if (updates.branding) updates.branding = stripCorruptedSpreadKeys(updates.branding);
  if (updates.feature_flags) updates.feature_flags = stripCorruptedSpreadKeys(updates.feature_flags);
  return updates;
};

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
    delete plain.encrypted_db_pass;
    return normalizeTenant(plain);
  });
};

export const getTenantDetails = async (tenantId) => {
  const { Tenant, GlobalUser } = getMasterModels();

  const tenant = await Tenant.findByPk(tenantId, {
    include: [{ model: GlobalUser, attributes: ["global_user_id", "email"] }],
  });

  if (!tenant) throw new AppError("Tenant not found.", 404);

  const plain = normalizeTenant(tenant.get({ plain: true }));
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
    tenantConfig = await models.TenantConfig.findOne({
      order: [["updatedAt", "DESC"]],
      raw: true,
    });
  } catch {
    // Tenant DB unreachable — don't crash
  }

  return { tenant: plain, tenantConfig };
};

// ============================================================================
// CREATE TENANT (full provisioning)
// ============================================================================
export const createTenant = async ({
  display_name,
  contact_email,
  admin_username,
  admin_password,
  tier = "Basic",
  monthly_rate = 0,
  db_name_slug,
}) => {
  const { Tenant, GlobalUser } = getMasterModels();

  // Guard: email must be unique across all global users
  const existing = await GlobalUser.findOne({ where: { email: contact_email } });
  if (existing) throw new AppError("A user with this email already exists.", 400);

  // Generate IDs & DB name
  const tenant_id = crypto.randomUUID();
  const rawSlug = (db_name_slug || display_name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/, "")
    .slice(0, 25);
  const db_name = `geargrid_${rawSlug}_${Date.now().toString(36)}`;

  const dbUser = process.env.USERNAME || "root";
  const dbPass = process.env.PASSWORD || "";
  const dbHost = process.env.HOST || "127.0.0.1";

  // 1. Create MySQL database
  await masterSequelize.query(`CREATE DATABASE IF NOT EXISTS \`${db_name}\``);

  let tenant = null;
  try {
    // 2. Insert tenant record in master DB
    tenant = await Tenant.create({
      tenant_id,
      db_name,
      db_user: dbUser,
      encrypted_db_pass: dbPass,
      db_host: dbHost,
      display_name,
      contact_email,
      tier,
      monthly_rate,
      subscription_status: "Active",
      feature_flags: {
        continuous_return: true,
        accounting_module: true,
        bulk_import: true,
        maintenance_module: true,
      },
      branding: {
        primaryColor: "#2563eb",
        secondaryColor: "#4f46e5",
        accentColor: "#3b82f6",
        logoUrl: null,
        businessName: display_name,
      },
    });

    // 3. Connect to new tenant DB and sync all tables
    const conn = await getTenantConnection(db_name, dbUser, dbPass, dbHost);
    const models = initTenantModels(conn);
    await conn.sync({ force: false });

    // 4. Seed TenantConfig
    await models.TenantConfig.create({
      business_display_name: display_name,
      primary_color: "#2563eb",
      secondary_color: "#4f46e5",
      currency_code: "LKR",
      timezone: "Asia/Colombo",
      status: 1,
    });

    // 5. Seed default Warehouse
    const warehouse = await models.Warehouse.create({
      location_name: "Main Warehouse",
      address: null,
      contact_number: null,
    });

    // 6. Seed default Roles
    const adminRole = await models.Role.create({ role_name: "Admin", hierarchy_level: 100 });
    await models.Role.create({ role_name: "Manager", hierarchy_level: 50 });
    await models.Role.create({ role_name: "Technician", hierarchy_level: 20 });

    // 7. Seed Permissions and assign all to Admin role
    const permissions = [];
    for (const perm of PERMISSION_CATALOG) {
      const [p] = await models.Permission.findOrCreate({
        where: { permission_code: perm.permission_code },
        defaults: perm,
      });
      permissions.push(p);
    }
    await adminRole.setPermissions(permissions);

    // 8. Create admin user in tenant DB
    const password_hash = await bcrypt.hash(admin_password, 12);
    const tenantUser = await models.User.create({
      username: admin_username,
      email: contact_email,
      password_hash,
      first_name: "Admin",
      last_name: "User",
      nic_no: `ADMIN-${Date.now()}`,
      warehouse_id: warehouse.warehouse_id,
      is_active: true,
    });
    await tenantUser.addRole(adminRole);

    // 9. Create GlobalUser entry (enables login from master auth)
    await GlobalUser.create({
      email: contact_email,
      password_hash,
      target_tenant_id: tenant_id,
    });

    const plain = tenant.get({ plain: true });
    delete plain.encrypted_db_pass;
    return plain;
  } catch (err) {
    // Rollback: remove master DB record if provisioning failed mid-way
    if (tenant) {
      await Tenant.destroy({ where: { tenant_id } }).catch(() => {});
    }
    await masterSequelize
      .query(`DROP DATABASE IF EXISTS \`${db_name}\``)
      .catch(() => {});
    throw err;
  }
};

// ============================================================================
// TENANT CONFIG UPDATE
// ============================================================================
const UPDATABLE_FIELDS = [
  "subscription_status", "tier", "max_users", "feature_flags",
  "display_name", "contact_email", "contact_phone",
  "monthly_rate", "next_billing_date",
  "cors_whitelist", "branding", "internal_notes",
];

const parseJsonField = (val) => {
  if (val == null) return {};
  if (typeof val === "string") {
    try { return JSON.parse(val) || {}; } catch { return {}; }
  }
  return val;
};

const syncTenantConfigFromMaster = async (tenant) => {
  try {
    const conn = await getTenantConnection(
      tenant.db_name,
      tenant.db_user,
      tenant.encrypted_db_pass,
      tenant.db_host,
    );
    const models = initTenantModels(conn);

    const branding = parseJsonField(tenant.branding);
    const updates = {};
    if (branding.businessName) updates.business_display_name = branding.businessName;
    else if (tenant.display_name) updates.business_display_name = tenant.display_name;
    if (branding.primaryColor) updates.primary_color = branding.primaryColor;
    if (branding.secondaryColor) updates.secondary_color = branding.secondaryColor;
    if (branding.logoUrl !== undefined) updates.logo_url = branding.logoUrl || null;

    if (Object.keys(updates).length === 0) return;

    const existing = await models.TenantConfig.findOne({
      order: [["updatedAt", "DESC"]],
    });
    if (existing) {
      await existing.update(updates);
    } else {
      await models.TenantConfig.create({
        business_display_name: updates.business_display_name || "My Rental Co",
        primary_color: updates.primary_color || "#2563eb",
        secondary_color: updates.secondary_color || "#4f46e5",
        logo_url: updates.logo_url || null,
        currency_code: "LKR",
        timezone: "Asia/Colombo",
        status: 1,
      });
    }
  } catch (err) {
    console.warn(
      `⚠️ Could not sync TenantConfig for ${tenant.db_name}:`,
      err.message,
    );
  }
};

const recomputeCorsOrigins = async () => {
  const { PlatformConfig, Tenant } = getMasterModels();
  let globalOrigins = [];
  try {
    const config = await PlatformConfig.findByPk("cors_origins");
    if (config?.config_value) {
      const val = config.config_value;
      globalOrigins = typeof val === "string" ? JSON.parse(val) : val || [];
    }
  } catch {
    /* ignore */
  }
  const tenants = await Tenant.findAll({ attributes: ["cors_whitelist"] });
  const tenantOrigins = tenants.flatMap((t) => {
    const w = t.cors_whitelist;
    if (Array.isArray(w)) return w;
    if (typeof w === "string") {
      try { return JSON.parse(w) || []; } catch { return []; }
    }
    return [];
  });
  const merged = Array.from(new Set([...globalOrigins, ...tenantOrigins]));
  updateCorsOrigins(merged);
};

export const updateTenantConfig = async (tenantId, updates) => {
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError("Tenant not found.", 404);

  updates = sanitizeUpdatePayload({ ...updates });
  const filtered = {};
  for (const key of UPDATABLE_FIELDS) {
    if (updates[key] !== undefined) filtered[key] = updates[key];
  }

  await tenant.update(filtered);
  await tenant.reload();

  // Sync display_name + branding into the tenant's own TENANT_CONFIG
  if (filtered.display_name !== undefined || filtered.branding !== undefined) {
    await syncTenantConfigFromMaster(tenant);
  }

  // Refresh global CORS allow-list if per-tenant whitelist changed
  if (filtered.cors_whitelist !== undefined) {
    try { await recomputeCorsOrigins(); } catch (e) {
      console.warn("⚠️ recomputeCorsOrigins failed:", e.message);
    }
  }

  const plain = normalizeTenant(tenant.get({ plain: true }));
  delete plain.encrypted_db_pass;
  return plain;
};

export { recomputeCorsOrigins };

// ============================================================================
// LOGO UPLOAD
// ============================================================================
export const saveTenantLogo = async (tenantId, fileUrl) => {
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError("Tenant not found.", 404);

  const currentBranding =
    typeof tenant.branding === "string"
      ? (() => { try { return JSON.parse(tenant.branding); } catch { return {}; } })()
      : tenant.branding || {};
  const cleanedBranding = stripCorruptedSpreadKeys(currentBranding);
  cleanedBranding.logoUrl = fileUrl;

  await tenant.update({ branding: cleanedBranding });
  await tenant.reload();
  await syncTenantConfigFromMaster(tenant);

  const plain = normalizeTenant(tenant.get({ plain: true }));
  delete plain.encrypted_db_pass;
  return plain;
};

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
  if (paymentData.status === "Paid" && tenant.subscription_status === "Overdue") {
    await tenant.update({ subscription_status: "Active" });
  }

  return payment.get({ plain: true });
};

export const getPaymentHistory = async (tenantId) => {
  const { TenantSubscription, Tenant } = getMasterModels();
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
  if (!config) return { origins: [] };
  const val = config.config_value;
  const origins = typeof val === 'string' ? JSON.parse(val) : val;
  return { origins };
};

export const updateGlobalCors = async (origins) => {
  const { PlatformConfig } = getMasterModels();
  await PlatformConfig.upsert({
    config_key: "cors_origins",
    config_value: origins,
    updatedAt: new Date(),
  });
  // Rebuild combined allow-list (global + per-tenant whitelists)
  await recomputeCorsOrigins();
  return { origins };
};

// ============================================================================
// TENANT USERS (for impersonation picker)
// ============================================================================
export const getTenantUsers = async (tenantId) => {
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError("Tenant not found.", 404);

  try {
    const conn = await getTenantConnection(
      tenant.db_name,
      tenant.db_user,
      tenant.encrypted_db_pass,
      tenant.db_host,
    );
    const models = initTenantModels(conn);

    const users = await models.User.findAll({
      attributes: ["user_id", "username", "email", "first_name", "last_name", "is_active"],
      include: [
        {
          model: models.Role,
          attributes: ["role_id", "role_name"],
          through: { attributes: [] },
        },
      ],
      order: [["user_id", "ASC"]],
    });

    return users.map((u) => ({
      user_id: u.user_id,
      username: u.username,
      email: u.email,
      first_name: u.first_name,
      last_name: u.last_name,
      status: u.is_active ? "Active" : "Inactive",
      is_active: u.is_active,
      roles: u.Roles?.map((r) => r.role_name) || [],
      role_ids: u.Roles?.map((r) => r.role_id) || [],
    }));
  } catch {
    // Tenant DB unreachable — return empty list gracefully
    return [];
  }
};

// ============================================================================
// TENANT USER CRUD
// ============================================================================
const getTenantConn = async (tenantId) => {
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError("Tenant not found.", 404);
  const conn = await getTenantConnection(
    tenant.db_name,
    tenant.db_user,
    tenant.encrypted_db_pass,
    tenant.db_host,
  );
  return { conn, models: initTenantModels(conn) };
};

export const getTenantRoles = async (tenantId) => {
  const { models } = await getTenantConn(tenantId);
  const roles = await models.Role.findAll({ attributes: ["role_id", "role_name", "hierarchy_level"], order: [["hierarchy_level", "DESC"]] });
  return roles.map((r) => r.get({ plain: true }));
};

export const createTenantUser = async (tenantId, { username, email, password, first_name, last_name, role_id }) => {
  const { GlobalUser } = getMasterModels();

  // Email uniqueness guard
  const existingGU = await GlobalUser.findOne({ where: { email } });
  if (existingGU) throw new AppError("A user with this email already exists.", 400);

  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError("Tenant not found.", 404);

  const conn = await getTenantConnection(tenant.db_name, tenant.db_user, tenant.encrypted_db_pass, tenant.db_host);
  const models = initTenantModels(conn);

  const existingUser = await models.User.findOne({ where: { email } });
  if (existingUser) throw new AppError("Email already exists in this tenant.", 400);

  const password_hash = await bcrypt.hash(password, 12);

  // Get first warehouse for the new user
  const warehouse = await models.Warehouse.findOne({ order: [["warehouse_id", "ASC"]] });

  const newUser = await models.User.create({
    username,
    email,
    password_hash,
    first_name,
    last_name,
    nic_no: `SA-${Date.now()}`,
    warehouse_id: warehouse?.warehouse_id || null,
    is_active: true,
  });

  // Assign role if provided
  if (role_id) {
    const role = await models.Role.findByPk(role_id);
    if (role) await newUser.addRole(role);
  }

  // Create GlobalUser entry so they can log in
  await GlobalUser.create({ email, password_hash, target_tenant_id: tenantId });

  const plain = newUser.get({ plain: true });
  delete plain.password_hash;
  const roles = await newUser.getRoles({ attributes: ["role_name"] });
  plain.roles = roles.map((r) => r.role_name);
  plain.status = "Active";
  return plain;
};

export const updateTenantUser = async (tenantId, userId, { username, email, first_name, last_name, is_active, role_id, password }) => {
  const { GlobalUser } = getMasterModels();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError("Tenant not found.", 404);

  const conn = await getTenantConnection(tenant.db_name, tenant.db_user, tenant.encrypted_db_pass, tenant.db_host);
  const models = initTenantModels(conn);

  const user = await models.User.findByPk(userId);
  if (!user) throw new AppError("User not found.", 404);

  const oldEmail = user.email;
  const updates = {};
  if (username !== undefined) updates.username = username;
  if (first_name !== undefined) updates.first_name = first_name;
  if (last_name !== undefined) updates.last_name = last_name;
  if (is_active !== undefined) updates.is_active = is_active;
  if (email !== undefined) updates.email = email;

  if (password) {
    updates.password_hash = await bcrypt.hash(password, 12);
  }

  await user.update(updates);

  // Update role if changed
  if (role_id !== undefined) {
    const role = await models.Role.findByPk(role_id);
    if (role) await user.setRoles([role]);
  }

  // Sync GlobalUser if email or password changed
  const emailChanged = email && email !== oldEmail;
  if (emailChanged) {
    await GlobalUser.update({ email }, { where: { email: oldEmail } });
  }
  if (password && updates.password_hash) {
    await GlobalUser.update({ password_hash: updates.password_hash }, { where: { email: emailChanged ? email : oldEmail } });
  }

  const plain = user.get({ plain: true });
  delete plain.password_hash;
  const assignedRoles = await user.getRoles({ attributes: ["role_name"] });
  plain.roles = assignedRoles.map((r) => r.role_name);
  plain.status = user.is_active ? "Active" : "Inactive";
  return plain;
};

export const deleteTenantUser = async (tenantId, userId) => {
  const { GlobalUser } = getMasterModels();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError("Tenant not found.", 404);

  const conn = await getTenantConnection(tenant.db_name, tenant.db_user, tenant.encrypted_db_pass, tenant.db_host);
  const models = initTenantModels(conn);

  const user = await models.User.findByPk(userId);
  if (!user) throw new AppError("User not found.", 404);

  const email = user.email;
  await user.destroy();

  // Remove GlobalUser login entry
  await GlobalUser.destroy({ where: { email } });
};

// ============================================================================
// PLATFORM DASHBOARD KPIs
// ============================================================================
export const getPlatformDashboard = async () => {
  const { Tenant, GlobalUser, TenantSubscription, sequelize } = getMasterModels();

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
    TenantSubscription.sum("amount", { where: { status: "Paid" } }),
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
export const generateImpersonationToken = async (superAdminId, tenantId, targetUserId) => {
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
      { model: models.Role, attributes: ["role_name"], through: { attributes: [] } },
    ],
  });

  if (!targetUser) throw new AppError("Target user not found in tenant database.", 404);

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
    metadata: { targetUsername: targetUser.username, tenantDbName: tenant.db_name },
  });

  return {
    impersonationToken,
    user: { id: targetUser.user_id, username: targetUser.username, email: targetUser.email, roles },
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
    include: [{ model: SuperAdmin, attributes: ["email", "display_name"] }],
    order: [["createdAt", "DESC"]],
    limit,
    offset,
  });

  return { totalItems: count, logs: rows };
};
