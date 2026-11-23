import { DataTypes } from "sequelize";

export default (sequelize) => {
  const RetailStockLevel = sequelize.define(
    "RetailStockLevel",
    {
      product_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      warehouse_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      qty_on_hand: {
        type: DataTypes.DECIMAL(14, 3),
        allowNull: false,
        defaultValue: 0,
      },
      reorder_level: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
      reorder_qty: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
      counted_at: { type: DataTypes.DATE, allowNull: true },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "RETAIL_STOCK_LEVELS",
      timestamps: true,
      createdAt: false,
      indexes: [
        { fields: ["updatedAt"], name: "idx_retail_stock_levels_updated" },
      ],
    },
  );

  return RetailStockLevel;
};
