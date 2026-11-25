import { DataTypes } from "sequelize";

export default (sequelize) => {
  const CallLog = sequelize.define(
    "CallLog",
    {
      call_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      operator_device_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      source: {
        type: DataTypes.ENUM("phone", "manual"),
        allowNull: false,
        defaultValue: "phone",
        validate: {
          isIn: [["phone", "manual"]],
        },
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      invoice_ids: {
        type: DataTypes.JSON,
        allowNull: true,
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
      sim_label: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      number_masked: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      callback_handled_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "CALL_LOGS",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["client_call_id"],
          name: "uq_call_logs_client_call_id",
        },
        {
          fields: ["customer_id", "started_at"],
          name: "idx_call_logs_customer_started",
        },
        {
          fields: ["phone_e164"],
          name: "idx_call_logs_phone_e164",
        },
        {
          fields: ["started_at"],
          name: "idx_call_logs_started_at",
        },
      ],
    },
  );

  return CallLog;
};
