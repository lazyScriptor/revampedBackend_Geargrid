import { DataTypes } from "sequelize";
import { tableExists, addColumnIfMissing } from "../lib/schemaGuards.js";

const TABLE = "OPERATOR_DEVICES";

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) return;

  await addColumnIfMissing(qi, TABLE, "token_hash", {
    type: DataTypes.STRING(64),
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "token_issued_at", {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "app_version", {
    type: DataTypes.STRING(20),
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "contacts_synced_at", {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "briefs_synced_at", {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "is_native_app", {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await addColumnIfMissing(qi, TABLE, "contact_sync_enabled", {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await addColumnIfMissing(qi, TABLE, "push_token", {
    type: DataTypes.STRING(255),
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "push_token_updated_at", {
    type: DataTypes.DATE,
    allowNull: true,
  });
};

export const down = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) return;
  const cols = await qi.describeTable(TABLE);
  for (const col of [
    "push_token_updated_at",
    "push_token",
    "contact_sync_enabled",
    "is_native_app",
    "briefs_synced_at",
    "contacts_synced_at",
    "app_version",
    "token_issued_at",
    "token_hash",
  ]) {
    if (cols[col]) await qi.removeColumn(TABLE, col);
  }
};
