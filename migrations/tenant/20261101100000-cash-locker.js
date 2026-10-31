// migrations/tenant/20261101100000-cash-locker.js
//
// Cash locker (the shop's cash drawer):
//  • CASH_LOCKER_COUNTS        — every opening / closing count, with what was sent home
//  • PAYMENTS.is_advance       — marks the advance taken at dispatch (backfilled from INVOICES.advance_paid)
//  • INVOICES.advance_at_home  — an old advance that already went home, so the drawer does not hold it
//  • EXPENSES.paid_from_locker — the expense was paid with drawer cash
//  • permissions: locker:count (open/close the drawer) and locker:manage (history, accept, float)
// Fully idempotent (new tenants get the tables from model sync first).

import { DataTypes } from "sequelize";

const tableExists = async (qi, name) => {
  const tables = await qi.showAllTables();
  return tables.map((t) => (typeof t === "string" ? t : Object.values(t)[0])).includes(name);
};

const TABLE_OPTIONS = { charset: "utf8mb4", collate: "utf8mb4_unicode_ci" };

const PERMS = [
  ["locker:count", "Open and close the cash locker, record locker expenses"],
  ["locker:manage", "See the cash locker history, accept differences and set the float"],
];

const addColumnIfMissing = async (qi, table, column, spec) => {
  const cols = await qi.describeTable(table);
  if (!cols[column]) await qi.addColumn(table, column, spec);
};

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, "CASH_LOCKER_COUNTS"))) {
    await qi.createTable("CASH_LOCKER_COUNTS", {
      count_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      kind: { type: DataTypes.STRING(10), allowNull: false },
      business_date: { type: DataTypes.DATEONLY, allowNull: false },
      counted_at: { type: DataTypes.DATE, allowNull: false },
      counted_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      expected_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      difference: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      keep_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      sent_home: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      left_in_drawer: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: true },
      counted_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
      reviewed_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
      reviewed_at: { type: DataTypes.DATE, allowNull: true },
      review_note: { type: DataTypes.TEXT, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    }, TABLE_OPTIONS);
    await qi.addIndex("CASH_LOCKER_COUNTS", ["business_date"], { name: "idx_locker_business_date" });
    await qi.addIndex("CASH_LOCKER_COUNTS", ["counted_at"], { name: "idx_locker_counted_at" });
  }

  await addColumnIfMissing(qi, "PAYMENTS", "is_advance", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addColumnIfMissing(qi, "INVOICES", "advance_at_home", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addColumnIfMissing(qi, "EXPENSES", "paid_from_locker", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  const sequelize = qi.sequelize;

  // The advance is the first payment on an invoice whose amount equals INVOICES.advance_paid.
  await sequelize.query(`
    UPDATE PAYMENTS p
      JOIN (
        SELECT i.invoice_id, MIN(p2.payment_id) AS pid
          FROM INVOICES i
          JOIN PAYMENTS p2 ON p2.invoice_id = i.invoice_id AND p2.payment_amount = i.advance_paid
         WHERE i.advance_paid > 0
         GROUP BY i.invoice_id
      ) x ON x.pid = p.payment_id
       SET p.is_advance = 1
     WHERE p.is_advance = 0`);

  // ── permissions ──
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
        `INSERT INTO \`${permTable}\` (permission_code, module_name, description) VALUES (?, 'Cash Locker', ?)`,
        { replacements: [code, description] },
      );
      permIds[code] = insertId;
    }
  }

  const grant = async (roleId, permId) => {
    const [has] = await sequelize.query(`SELECT 1 FROM \`${rolePermTable}\` WHERE role_id = ? AND permission_id = ? LIMIT 1`, { replacements: [roleId, permId] });
    if (!has[0]) await sequelize.query(`INSERT INTO \`${rolePermTable}\` (role_id, permission_id) VALUES (?, ?)`, { replacements: [roleId, permId] });
  };

  // Admin/owner/manager-level roles: count + manage.
  const [admins] = await sequelize.query(
    `SELECT role_id FROM \`${rolesTable}\` WHERE hierarchy_level >= 50 OR LOWER(role_name) LIKE '%admin%' OR LOWER(role_name) LIKE '%owner%'`,
  );
  for (const r of admins) for (const id of Object.values(permIds)) await grant(r.role_id, id);

  // Everyone who takes payments counts the drawer.
  const [payPerms] = await sequelize.query(
    `SELECT permission_id FROM \`${permTable}\` WHERE permission_code IN ('invoice:create', 'invoice:action:add_payment', 'invoice:action:process_return')`,
  );
  if (payPerms.length) {
    const [cashiers] = await sequelize.query(
      `SELECT DISTINCT role_id FROM \`${rolePermTable}\` WHERE permission_id IN (${payPerms.map(() => "?").join(",")})`,
      { replacements: payPerms.map((p) => p.permission_id) },
    );
    for (const r of cashiers) await grant(r.role_id, permIds["locker:count"]);
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
  const drop = async (table, column) => {
    const cols = await qi.describeTable(table);
    if (cols[column]) await qi.removeColumn(table, column);
  };
  await drop("EXPENSES", "paid_from_locker");
  await drop("INVOICES", "advance_at_home");
  await drop("PAYMENTS", "is_advance");
  if (await tableExists(qi, "CASH_LOCKER_COUNTS")) await qi.dropTable("CASH_LOCKER_COUNTS");
};
