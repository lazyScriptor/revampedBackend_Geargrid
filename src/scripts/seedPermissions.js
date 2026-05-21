#!/usr/bin/env node
/**
 * Seed Granular Permissions
 * Seeds the full fine-grained permission catalog into a tenant database.
 * Usage: node src/scripts/seedPermissions.js --tenant geargrid_tenant_template
 */
import { masterSequelize, getTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { initMasterModels } from "../models/master/index.js";
import { QueryTypes } from "sequelize";

const args = process.argv.slice(2);
const tenantIdx = args.indexOf("--tenant");

if (tenantIdx === -1) {
  console.error(
    "Usage: node src/scripts/seedPermissions.js --tenant <db_name>",
  );
  process.exit(1);
}

const tenantDbName = args[tenantIdx + 1];

// Complete permission catalog
const PERMISSION_CATALOG = [
  // Dashboard
  { permission_code: "dashboard:view", module_name: "Dashboard", description: "View the main dashboard" },

  // Invoices
  { permission_code: "invoice:create", module_name: "Invoices", description: "Create new invoices" },
  { permission_code: "invoice:view", module_name: "Invoices", description: "View invoices" },
  { permission_code: "invoice:edit", module_name: "Invoices", description: "Edit invoices" },
  { permission_code: "invoice:delete", module_name: "Invoices", description: "Delete invoices" },
  { permission_code: "invoice:field:edit_discount", module_name: "Invoices", description: "Edit invoice discount field" },
  { permission_code: "invoice:field:edit_transport_fee", module_name: "Invoices", description: "Edit transport fee field" },
  { permission_code: "invoice:action:process_return", module_name: "Invoices", description: "Process equipment returns" },
  { permission_code: "invoice:action:add_payment", module_name: "Invoices", description: "Record payment against invoice" },
  { permission_code: "invoice:action:send_reminder", module_name: "Invoices", description: "Send payment reminder emails" },

  // Equipment
  { permission_code: "equipment:create", module_name: "Equipment", description: "Add new equipment" },
  { permission_code: "equipment:view", module_name: "Equipment", description: "View equipment list" },
  { permission_code: "equipment:edit", module_name: "Equipment", description: "Edit equipment details" },
  { permission_code: "equipment:delete", module_name: "Equipment", description: "Delete equipment" },
  { permission_code: "equipment:action:bulk_import", module_name: "Equipment", description: "Bulk import via CSV" },

  // Equipment Categories
  { permission_code: "category:create", module_name: "Categories", description: "Create equipment categories" },
  { permission_code: "category:view", module_name: "Categories", description: "View categories" },
  { permission_code: "category:edit", module_name: "Categories", description: "Edit categories" },
  { permission_code: "category:delete", module_name: "Categories", description: "Delete categories" },

  // Customers
  { permission_code: "customer:create", module_name: "Customers", description: "Add new customers" },
  { permission_code: "customer:view", module_name: "Customers", description: "View customer list" },
  { permission_code: "customer:edit", module_name: "Customers", description: "Edit customer details" },
  { permission_code: "customer:delete", module_name: "Customers", description: "Delete customers" },
  { permission_code: "customer:action:bulk_import", module_name: "Customers", description: "Bulk import customers" },

  // Accounting & Reports
  { permission_code: "accounting:view", module_name: "Accounting", description: "View accounting dashboard" },
  { permission_code: "accounting:export_pdf", module_name: "Accounting", description: "Export reports as PDF" },
  { permission_code: "accounting:export_excel", module_name: "Accounting", description: "Export reports as Excel" },
  { permission_code: "accounting:manage_expenses", module_name: "Accounting", description: "Create/edit/delete expenses" },

  // Reports — unified analytics surface
  { permission_code: "reports:export", module_name: "Reports", description: "Export reports as CSV / PDF / Excel" },

  // Maintenance / Defects
  { permission_code: "defect:create", module_name: "Maintenance", description: "Report new defects" },
  { permission_code: "defect:view", module_name: "Maintenance", description: "View defect log" },
  { permission_code: "defect:assign_technician", module_name: "Maintenance", description: "Assign technician to defect" },
  { permission_code: "defect:resolve", module_name: "Maintenance", description: "Mark defect as resolved" },

  // Warehouses
  { permission_code: "warehouse:view", module_name: "Warehouses", description: "View warehouses" },
  { permission_code: "warehouse:manage", module_name: "Warehouses", description: "Create/edit/delete warehouses" },

  // Data Arena (Bulk Ops)
  { permission_code: "data_arena:view", module_name: "Data Arena", description: "View data arena" },
  { permission_code: "data_arena:export", module_name: "Data Arena", description: "Export data" },
  { permission_code: "data_arena:import", module_name: "Data Arena", description: "Import bulk data" },

  // User & Role Management (Granular)
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

  // Tenant Config
  { permission_code: "config:view", module_name: "Configuration", description: "View tenant configuration" },
  { permission_code: "config:manage", module_name: "Configuration", description: "Edit tenant configuration" },

  // Workforce
  { permission_code: "workforce:view", module_name: "Workforce", description: "View workforce roster" },
  { permission_code: "workforce:manage", module_name: "Workforce", description: "Manage technicians" },

  // Rental History
  { permission_code: "rental_history:view", module_name: "Rental History", description: "View rental history" },

  // Legacy module-level permissions (backward compat)
  { permission_code: "inventory_permission", module_name: "Legacy", description: "Legacy module-level inventory access" },
];

(async () => {
  try {
    await masterSequelize.authenticate();
    initMasterModels(masterSequelize);

    // Get tenant connection details
    const tenants = await masterSequelize.query(
      "SELECT db_name, db_user, encrypted_db_pass, db_host FROM TENANTS WHERE db_name = :dbName",
      { replacements: { dbName: tenantDbName }, type: QueryTypes.SELECT },
    );

    if (tenants.length === 0) {
      console.error(`❌ Tenant "${tenantDbName}" not found.`);
      process.exit(1);
    }

    const t = tenants[0];
    const conn = await getTenantConnection(
      t.db_name,
      t.db_user,
      t.encrypted_db_pass,
      t.db_host,
    );
    const models = initTenantModels(conn);
    await conn.sync();

    let created = 0;
    let skipped = 0;

    for (const perm of PERMISSION_CATALOG) {
      const [, wasCreated] = await models.Permission.findOrCreate({
        where: { permission_code: perm.permission_code },
        defaults: perm,
      });
      if (wasCreated) created++;
      else skipped++;
    }

    console.log(
      `✅ Permission seed complete for "${tenantDbName}": ${created} created, ${skipped} already existed.`,
    );
    process.exit(0);
  } catch (error) {
    console.error("❌ Seed failed:", error.message);
    process.exit(1);
  }
})();
