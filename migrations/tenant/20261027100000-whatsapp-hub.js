// migrations/tenant/20261027100000-whatsapp-hub.js
//
// WhatsApp hub (free click-to-chat integration):
//  • WHATSAPP_MESSAGE_LOGS — audit trail of chats opened from the hub
//  • WHATSAPP_TEMPLATES    — a shop's own wording per message type + language
//  • CUSTOMERS.whatsapp_opt_out — "do not message me"
//  • permissions: whatsapp:send (use the hub) and whatsapp:manage (edit templates/settings)
// Fully idempotent (new tenants get the tables from model sync first).

import { DataTypes } from "sequelize";

const tableExists = async (qi, name) => {
  const tables = await qi.showAllTables();
  return tables.map((t) => (typeof t === "string" ? t : Object.values(t)[0])).includes(name);
};

const PERMS = [
  ["whatsapp:send", "Use the WhatsApp hub: send receipts, reminders and follow-ups"],
  ["whatsapp:manage", "Edit WhatsApp message templates and settings"],
];

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, "WHATSAPP_MESSAGE_LOGS"))) {
    await qi.createTable("WHATSAPP_MESSAGE_LOGS", {
      log_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      customer_id: { type: DataTypes.INTEGER, allowNull: true },
      invoice_id: { type: DataTypes.INTEGER, allowNull: true },
      template_key: { type: DataTypes.STRING(40), allowNull: false },
      language: { type: DataTypes.STRING(5), allowNull: false, defaultValue: "en" },
      to_phone: { type: DataTypes.STRING(20), allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: false },
      channel: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "link" },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "opened" },
      sent_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await qi.addIndex("WHATSAPP_MESSAGE_LOGS", ["customer_id"], { name: "idx_wa_log_customer" });
    await qi.addIndex("WHATSAPP_MESSAGE_LOGS", ["invoice_id"], { name: "idx_wa_log_invoice" });
    await qi.addIndex("WHATSAPP_MESSAGE_LOGS", ["createdAt"], { name: "idx_wa_log_created" });
  }

  if (!(await tableExists(qi, "WHATSAPP_TEMPLATES"))) {
    await qi.createTable("WHATSAPP_TEMPLATES", {
      template_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      template_key: { type: DataTypes.STRING(40), allowNull: false },
      language: { type: DataTypes.STRING(5), allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: false },
      updated_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await qi.addIndex("WHATSAPP_TEMPLATES", ["template_key", "language"], { unique: true, name: "uq_wa_template_key_lang" });
  }

  const customerCols = await qi.describeTable("CUSTOMERS");
  if (!customerCols.whatsapp_opt_out) {
    await qi.addColumn("CUSTOMERS", "whatsapp_opt_out", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  }

  // ── permissions ──
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
        `INSERT INTO \`${permTable}\` (permission_code, module_name, description) VALUES (?, 'Messages', ?)`,
        { replacements: [code, description] },
      );
      permIds[code] = insertId;
    }
  }

  const grant = async (roleId, permId) => {
    const [has] = await sequelize.query(`SELECT 1 FROM \`${rolePermTable}\` WHERE role_id = ? AND permission_id = ? LIMIT 1`, { replacements: [roleId, permId] });
    if (!has[0]) await sequelize.query(`INSERT INTO \`${rolePermTable}\` (role_id, permission_id) VALUES (?, ?)`, { replacements: [roleId, permId] });
  };

  // Admin/owner/manager-level roles: send + manage.
  const [admins] = await sequelize.query(
    `SELECT role_id FROM \`${rolesTable}\` WHERE hierarchy_level >= 50 OR LOWER(role_name) LIKE '%admin%' OR LOWER(role_name) LIKE '%owner%'`,
  );
  for (const r of admins) for (const id of Object.values(permIds)) await grant(r.role_id, id);

  // Everyone who can already view invoices may use the hub (send only).
  const [viewPerm] = await sequelize.query(`SELECT permission_id FROM \`${permTable}\` WHERE permission_code = 'invoice:view' LIMIT 1`);
  if (viewPerm[0]) {
    const [viewers] = await sequelize.query(`SELECT role_id FROM \`${rolePermTable}\` WHERE permission_id = ?`, { replacements: [viewPerm[0].permission_id] });
    for (const r of viewers) await grant(r.role_id, permIds["whatsapp:send"]);
  }
};

export const down = async ({ context: qi }) => {
  const sequelize = qi.sequelize;
  const [tables] = await sequelize.query("SHOW TABLES");
  const names = tables.map((t) => Object.values(t)[0]);
  const permTable = names.find((t) => t.toLowerCase() === "permissions") || "permissions";
  const rolePermTable =
    names.find((t) => t === "ROLE_PERMISSIONs" || t.toLowerCase() === "role_permissions") || "ROLE_PERMISSIONs";
  for (const [code] of PERMS) {
    const [found] = await sequelize.query(`SELECT permission_id FROM \`${permTable}\` WHERE permission_code = ? LIMIT 1`, { replacements: [code] });
    if (found[0]) {
      await sequelize.query(`DELETE FROM \`${rolePermTable}\` WHERE permission_id = ?`, { replacements: [found[0].permission_id] });
      await sequelize.query(`DELETE FROM \`${permTable}\` WHERE permission_id = ?`, { replacements: [found[0].permission_id] });
    }
  }
  const cols = await qi.describeTable("CUSTOMERS");
  if (cols.whatsapp_opt_out) await qi.removeColumn("CUSTOMERS", "whatsapp_opt_out");
  await qi.dropTable("WHATSAPP_TEMPLATES").catch(() => {});
  await qi.dropTable("WHATSAPP_MESSAGE_LOGS").catch(() => {});
};
