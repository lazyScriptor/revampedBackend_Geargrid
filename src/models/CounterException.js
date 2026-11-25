import { DataTypes } from "sequelize";

export const COUNTER_EXCEPTION_TYPES = [
  "unlisted_item",
  "price_change",
  "discount_over_limit",
  "below_cost",
  "negative_stock",
  "return_no_bill",
  "line_removed",
  "bill_void_after_print",
  "credit_over_limit",
  "backdated_bill",
  "drawer_open",
];

export const COUNTER_EXCEPTION_STATUSES = [
  "recorded",
  "waiting",
  "approved",
  "declined",
  "sorted",
];

export default (sequelize) => {
  const CounterException = sequelize.define(
    "CounterException",
    {
      exception_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      type: {
        type: DataTypes.ENUM(...COUNTER_EXCEPTION_TYPES),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...COUNTER_EXCEPTION_STATUSES),
        allowNull: false,
        defaultValue: "recorded",
      },
      invoice_id: { type: DataTypes.INTEGER, allowNull: true },
      sale_line_id: { type: DataTypes.INTEGER, allowNull: true },
      product_id: { type: DataTypes.INTEGER, allowNull: true },
      requested_by: { type: DataTypes.INTEGER, allowNull: false },
      approved_by: { type: DataTypes.INTEGER, allowNull: true },
      old_value: { type: DataTypes.JSON, allowNull: true },
      new_value: { type: DataTypes.JSON, allowNull: true },
      amount_impact: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      summary: { type: DataTypes.STRING(500), allowNull: true },
      note: { type: DataTypes.STRING(500), allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: true },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      resolved_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "COUNTER_EXCEPTIONS",
      timestamps: false,
      indexes: [
        { fields: ["status", "created_at"], name: "idx_counter_exceptions_status_created" },
        { fields: ["type", "created_at"], name: "idx_counter_exceptions_type_created" },
        { fields: ["requested_by"], name: "idx_counter_exceptions_requested_by" },
      ],
    },
  );

  return CounterException;
};
