// migrations/tenant/20261103100000-equipment-archive.js
//
// A machine that was ever rented or repaired is linked to invoice lines and defect logs, so it can
// never be removed from the database. Deleting one archives it: hidden from lists, the counter,
// stats and exports, but still named on its old invoices. Idempotent.

import { DataTypes } from "sequelize";

export const up = async ({ context: qi }) => {
  const cols = await qi.describeTable("EQUIPMENT");
  if (!cols.is_archived) await qi.addColumn("EQUIPMENT", "is_archived", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  if (!cols.archived_at) await qi.addColumn("EQUIPMENT", "archived_at", { type: DataTypes.DATE, allowNull: true });
};

export const down = async ({ context: qi }) => {
  const cols = await qi.describeTable("EQUIPMENT");
  if (cols.archived_at) await qi.removeColumn("EQUIPMENT", "archived_at");
  if (cols.is_archived) await qi.removeColumn("EQUIPMENT", "is_archived");
};
