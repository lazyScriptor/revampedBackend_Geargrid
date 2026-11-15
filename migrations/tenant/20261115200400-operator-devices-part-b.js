import { DataTypes } from "sequelize";
import { addColumnIfMissing, addIndexIfMissing, tableExists } from "../lib/schemaGuards.js";

const TABLE = "OPERATOR_DEVICES";

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) return;

  await addColumnIfMissing(qi, TABLE, "status", {
    type: DataTypes.ENUM("PENDING", "ACTIVE", "SUSPENDED", "REVOKED"),
    allowNull: false,
    defaultValue: "ACTIVE",
  });
  await addColumnIfMissing(qi, TABLE, "capabilities", {
    type: DataTypes.JSON,
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "brief_profile_id", {
    type: DataTypes.STRING(40),
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "contact_sync_mode", {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: "off",
  });
  await addColumnIfMissing(qi, TABLE, "call_logging_scope", {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: "customers_and_contacts",
  });
  await addColumnIfMissing(qi, TABLE, "sim_filter", {
    type: DataTypes.STRING(64),
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "device_model", {
    type: DataTypes.STRING(100),
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "os_version", {
    type: DataTypes.STRING(20),
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "reported_state", {
    type: DataTypes.JSON,
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "muted", {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await addColumnIfMissing(qi, TABLE, "approved_by", {
    type: DataTypes.INTEGER,
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "approved_at", {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "revoked_at", {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "prev_token_hash", {
    type: DataTypes.STRING(64),
    allowNull: true,
  });
  await addColumnIfMissing(qi, TABLE, "prev_token_expires_at", {
    type: DataTypes.DATE,
    allowNull: true,
  });

  await addIndexIfMissing(qi, TABLE, ["status"], {
    name: "idx_operator_devices_status",
  });

  // Backfill contact_sync_mode for existing phones that already turned sync on.
  await qi.sequelize.query(
    `UPDATE \`${TABLE}\` SET contact_sync_mode = 'all' WHERE contact_sync_enabled = 1 AND (contact_sync_mode IS NULL OR contact_sync_mode = 'off')`,
  );
};

export const down = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) return;
  const cols = await qi.describeTable(TABLE);
  const removable = [
    "prev_token_expires_at",
    "prev_token_hash",
    "revoked_at",
    "approved_at",
    "approved_by",
    "muted",
    "reported_state",
    "os_version",
    "device_model",
    "sim_filter",
    "call_logging_scope",
    "contact_sync_mode",
    "brief_profile_id",
    "capabilities",
    "status",
  ];
  for (const col of removable) {
    if (Object.prototype.hasOwnProperty.call(cols, col)) {
      await qi.removeColumn(TABLE, col);
    }
  }
};
