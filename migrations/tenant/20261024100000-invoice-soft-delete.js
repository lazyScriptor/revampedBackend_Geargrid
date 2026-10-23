// migrations/tenant/20261024100000-invoice-soft-delete.js
//
// Invoice soft-delete ("void with a reason") + restore.
//  • INVOICES gets is_deleted + who/when/why columns (+ restore columns).
//  • PAYMENTS gets is_voided so money on a deleted invoice drops out of revenue
//    but is still listed for reconciliation.
//  • Permissions: invoice:delete (cashier: only invoices with no money),
//    invoice:delete:any and invoice:restore (admin).
// Fully idempotent.

import { DataTypes } from "sequelize";

const addIfMissing = async (qi, table, cols) => {
  const existing = await qi.describeTable(table);
  for (const [name, def] of Object.entries(cols)) {
    if (!existing[name]) await qi.addColumn(table, name, def);
  }
};

const PERMS = [
  ["invoice:delete", "Delete invoices (only invoices with no payment recorded)"],
  ["invoice:delete:any", "Delete any invoice, including ones with payments"],
  ["invoice:restore", "Restore deleted invoices and view the deleted-invoices report"],
];

export const up = async ({ context: qi }) => {
  await addIfMissing(qi, "INVOICES", {
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    deleted_at: { type: DataTypes.DATE, allowNull: true },
    deleted_by: { type: DataTypes.INTEGER, allowNull: true },
    deleted_by_role: { type: DataTypes.STRING(100), allowNull: true },
    delete_reason: { type: DataTypes.STRING(100), allowNull: true },
    delete_note: { type: DataTypes.STRING(500), allowNull: true },
    delete_flagged: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    restored_at: { type: DataTypes.DATE, allowNull: true },
    restored_by: { type: DataTypes.INTEGER, allowNull: true },
  });
  await addIfMissing(qi, "PAYMENTS", {
    is_voided: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    voided_at: { type: DataTypes.DATE, allowNull: true },
  });

  const sequelize = qi.sequelize;
  const [tables] = await sequelize.query("SHOW TABLES");
  const names = tables.map((t) => Object.values(t)[0]);
  const permTable = names.find((t) => t.toLowerCase() === "permissions") || "permissions";
  const rolePermTable =
    names.find((t) => t === "ROLE_PERMISSIONs" || t.toLowerCase() === "role_permissions") || "ROLE_PERMISSIONs";
  const rolesTable = names.find((t) => t.toLowerCase() === "roles") || "roles";

  const permIds = {};
  for (const [code, description] of PERMS) {
    const [found] = await sequelize.query(`SELECT permission_id FROM \`${permTable}\` WHERE permission_code = ? LIMIT 1`, { replacements: [code] });
    if (found[0]) {
      permIds[code] = found[0].permission_id;
    } else {
      const [insertId] = await sequelize.query(
        `INSERT INTO \`${permTable}\` (permission_code, module_name, description) VALUES (?, 'Invoices', ?)`,
        { replacements: [code, description] },
      );
      permIds[code] = insertId;
    }
  }

  const grant = async (roleId, permId) => {
    const [has] = await sequelize.query(`SELECT 1 FROM \`${rolePermTable}\` WHERE role_id = ? AND permission_id = ? LIMIT 1`, { replacements: [roleId, permId] });
    if (!has[0]) await sequelize.query(`INSERT INTO \`${rolePermTable}\` (role_id, permission_id) VALUES (?, ?)`, { replacements: [roleId, permId] });
  };

  // Admin/owner/manager-level roles: everything. Cashier roles: basic delete only.
  const [admins] = await sequelize.query(
    `SELECT role_id FROM \`${rolesTable}\` WHERE hierarchy_level >= 50 OR LOWER(role_name) LIKE '%admin%' OR LOWER(role_name) LIKE '%owner%'`,
  );
  for (const r of admins) for (const id of Object.values(permIds)) await grant(r.role_id, id);

  const [cashiers] = await sequelize.query(`SELECT role_id FROM \`${rolesTable}\` WHERE LOWER(role_name) LIKE '%cashier%'`);
  for (const r of cashiers) await grant(r.role_id, permIds["invoice:delete"]);
};

export const down = async ({ context: qi }) => {
  const inv = await qi.describeTable("INVOICES");
  for (const c of ["is_deleted", "deleted_at", "deleted_by", "deleted_by_role", "delete_reason", "delete_note", "delete_flagged", "restored_at", "restored_by"]) {
    if (inv[c]) await qi.removeColumn("INVOICES", c);
  }
  const pay = await qi.describeTable("PAYMENTS");
  for (const c of ["is_voided", "voided_at"]) if (pay[c]) await qi.removeColumn("PAYMENTS", c);
};
