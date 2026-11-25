import { DataTypes } from "sequelize";

export const IDEMPOTENCY_STATUSES = ["processing", "completed"];

export default (sequelize) => {
  const SettlementIdempotencyKey = sequelize.define(
    "SettlementIdempotencyKey",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      scope: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      idempotency_key: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...IDEMPOTENCY_STATUSES),
        allowNull: false,
        defaultValue: "processing",
        validate: { isIn: [IDEMPOTENCY_STATUSES] },
      },
      response_status: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      response_body: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      tableName: "SETTLEMENT_IDEMPOTENCY_KEYS",
      timestamps: false,
    },
  );

  return SettlementIdempotencyKey;
};
