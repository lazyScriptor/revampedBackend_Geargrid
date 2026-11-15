import { DataTypes, literal } from "sequelize";
import { tableExists, addIndexIfMissing } from "../lib/schemaGuards.js";

const TABLE = "CALL_LOGS";

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) {
    await qi.createTable(
      TABLE,
      {
        call_id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        operator_device_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        client_call_id: {
          type: DataTypes.STRING(64),
          allowNull: false,
        },
        phone_e164: {
          type: DataTypes.STRING(20),
          allowNull: true,
        },
        raw_number: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
        direction: {
          type: DataTypes.ENUM("INCOMING", "OUTGOING", "MISSED"),
          allowNull: false,
        },
        customer_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        contact_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        started_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        ended_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        duration_seconds: {
          type: DataTypes.INTEGER,
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

  await addIndexIfMissing(qi, TABLE, ["client_call_id"], {
    unique: true,
    name: "uq_call_logs_client_call_id",
  });
  await addIndexIfMissing(qi, TABLE, ["customer_id", "started_at"], {
    name: "idx_call_logs_customer_started",
  });
  await addIndexIfMissing(qi, TABLE, ["phone_e164"], {
    name: "idx_call_logs_phone_e164",
  });
  await addIndexIfMissing(qi, TABLE, ["started_at"], {
    name: "idx_call_logs_started_at",
  });
};

export const down = async ({ context: qi }) => {
  if (await tableExists(qi, TABLE)) {
    await qi.dropTable(TABLE);
  }
};
