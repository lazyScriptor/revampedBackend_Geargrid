import { DataTypes, literal } from "sequelize";
import { tableExists, addIndexIfMissing } from "../lib/schemaGuards.js";

const TABLE = "PUSH_PREFERENCES";

export const up = async ({ context: qi }) => {
  const exists = await tableExists(qi, TABLE);
  if (!exists) {
    await qi.createTable(
      TABLE,
      {
        preference_id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        user_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        event_key: {
          type: DataTypes.STRING(40),
          allowNull: false,
        },
        enabled: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        min_amount: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
        },
        createdAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal("CURRENT_TIMESTAMP"),
        },
        updatedAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        },
      },
      { charset: "utf8mb4", collate: "utf8mb4_unicode_ci" },
    );
  }

  await addIndexIfMissing(qi, TABLE, ["user_id", "event_key"], {
    unique: true,
    name: "uq_push_preferences_user_event",
  });
  await addIndexIfMissing(qi, TABLE, ["user_id"], {
    name: "idx_push_preferences_user",
  });
};

export const down = async ({ context: qi }) => {
  if (await tableExists(qi, TABLE)) {
    await qi.dropTable(TABLE);
  }
};
