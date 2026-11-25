import { DataTypes } from "sequelize";

export const SETTLEMENT_LEFTOVER_MODES = ["credit", "change", "none"];
export const SETTLEMENT_SPLIT_RULES = ["oldest_first", "cheaper_for_customer"];

export default (sequelize) => {
  const CustomerSettlement = sequelize.define(
    "CustomerSettlement",
    {
      settlement_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      customer_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      settled_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      entered_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      return_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      payment_total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      leftover_mode: {
        type: DataTypes.ENUM(...SETTLEMENT_LEFTOVER_MODES),
        allowNull: false,
        defaultValue: "none",
        validate: { isIn: [SETTLEMENT_LEFTOVER_MODES] },
      },
      leftover_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      wallet_used_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      split_rule: {
        type: DataTypes.ENUM(...SETTLEMENT_SPLIT_RULES),
        allowNull: false,
        defaultValue: "oldest_first",
        validate: { isIn: [SETTLEMENT_SPLIT_RULES] },
      },
      note: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      is_voided: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      voided_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      voided_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      idempotency_key: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      snapshot_json: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      tableName: "CUSTOMER_SETTLEMENTS",
      timestamps: false,
    },
  );

  return CustomerSettlement;
};
