import { DataTypes } from "sequelize";

export const STOCK_MOVEMENT_TYPES = [
  "OPENING",
  "RECEIVE",
  "SALE",
  "SALE_RETURN",
  "ADJUST_IN",
  "ADJUST_OUT",
  "COUNT_IN",
  "COUNT_OUT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "SALE_VOID",
];

export default (sequelize) => {
  const RetailStockMovement = sequelize.define(
    "RetailStockMovement",
    {
      movement_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      product_id: { type: DataTypes.INTEGER, allowNull: false },
      warehouse_id: { type: DataTypes.INTEGER, allowNull: false },
      qty_change: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
      qty_after: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
      type: {
        type: DataTypes.ENUM(...STOCK_MOVEMENT_TYPES),
        allowNull: false,
      },
      reason: { type: DataTypes.STRING(30), allowNull: true },
      unit_cost: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: false,
        defaultValue: 0,
      },
      doc_id: { type: DataTypes.INTEGER, allowNull: true },
      sale_line_id: { type: DataTypes.INTEGER, allowNull: true },
      user_id: { type: DataTypes.INTEGER, allowNull: true },
      occurred_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "RETAIL_STOCK_MOVEMENTS",
      timestamps: false,
      indexes: [
        {
          fields: ["product_id", "warehouse_id", "occurred_at"],
          name: "idx_retail_movements_prod_wh_date",
        },
        {
          fields: ["type", "occurred_at"],
          name: "idx_retail_movements_type_date",
        },
        { fields: ["sale_line_id"], name: "idx_retail_movements_sale_line" },
        { fields: ["doc_id"], name: "idx_retail_movements_doc" },
      ],
    },
  );

  return RetailStockMovement;
};
