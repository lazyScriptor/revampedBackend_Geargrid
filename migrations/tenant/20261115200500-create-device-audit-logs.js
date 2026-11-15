import { DataTypes } from "sequelize";
import { addIndexIfMissing, tableExists } from "../lib/schemaGuards.js";

const TABLE = "DEVICE_AUDIT_LOGS";

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) {
    await qi.createTable(TABLE, {
      audit_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      operator_device_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      actor_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      action: {
        type: DataTypes.STRING(40),
        allowNull: false,
      },
      detail: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: qi.sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: qi.sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });
  }

  await addIndexIfMissing(qi, TABLE, ["operator_device_id"], {
    name: "idx_device_audit_device_id",
  });
  await addIndexIfMissing(qi, TABLE, ["createdAt"], {
    name: "idx_device_audit_created_at",
  });
};

export const down = async ({ context: qi }) => {
  if (await tableExists(qi, TABLE)) {
    await qi.dropTable(TABLE);
  }
};
