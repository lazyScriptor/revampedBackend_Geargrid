// migrations/tenant/20261025100000-accounting-fixes.js
//  • PAYMENTS.received_by_user_id  — who took the money (cash accountability)
//  • EXPENSES.category ENUM -> VARCHAR(50) — editable/extensible categories (validated in the service)
//  • EXPENSE_AUDIT — every expense create/edit/delete is logged with a full snapshot
// Idempotent.
import { DataTypes } from "sequelize";
import { repairZeroDates } from "../lib/schemaGuards.js";

const tableExists = async (qi, t) => {
  try { await qi.describeTable(t); return true; } catch { return false; }
};

export const up = async ({ context: qi }) => {
  const pay = await qi.describeTable("PAYMENTS");
  if (!pay.received_by_user_id) {
    await qi.addColumn("PAYMENTS", "received_by_user_id", { type: DataTypes.INTEGER, allowNull: true });
  }

  const exp = await qi.describeTable("EXPENSES");
  if (exp.category && !/varchar/i.test(exp.category.type)) {
    // changing the column type makes MySQL copy the table, and strict mode refuses rows holding the invalid
    // date 0000-00-00 (seen on the seeded demo tenant) — repair those first.
    await repairZeroDates(qi, "EXPENSES");
    await qi.changeColumn("EXPENSES", "category", { type: DataTypes.STRING(50), allowNull: false });
  }

  if (!(await tableExists(qi, "EXPENSE_AUDIT"))) {
    await qi.createTable("EXPENSE_AUDIT", {
      audit_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      expense_id: { type: DataTypes.INTEGER, allowNull: false },
      action: { type: DataTypes.STRING(20), allowNull: false }, // CREATED | UPDATED | DELETED
      actor_user_id: { type: DataTypes.INTEGER, allowNull: true },
      snapshot: { type: DataTypes.JSON, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    await qi.addIndex("EXPENSE_AUDIT", ["expense_id"], { name: "idx_expense_audit_expense" });
  }
};

export const down = async ({ context: qi }) => {
  if (await tableExists(qi, "EXPENSE_AUDIT")) await qi.dropTable("EXPENSE_AUDIT");
  const pay = await qi.describeTable("PAYMENTS");
  if (pay.received_by_user_id) await qi.removeColumn("PAYMENTS", "received_by_user_id");
};
