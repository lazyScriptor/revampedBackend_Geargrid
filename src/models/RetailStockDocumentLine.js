import { DataTypes } from "sequelize";

export default (sequelize) => {
  const RetailStockDocumentLine = sequelize.define(
    "RetailStockDocumentLine",
    {
      line_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      doc_id: { type: DataTypes.INTEGER, allowNull: false },
      product_id: { type: DataTypes.INTEGER, allowNull: false },
      unit_id: { type: DataTypes.INTEGER, allowNull: true },
      qty: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
      base_qty: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
      entered_unit_cost: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
      unit_cost: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
      counted_qty: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
      system_qty: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
      serials: { type: DataTypes.JSON, allowNull: true },
    },
    {
      tableName: "RETAIL_STOCK_DOCUMENT_LINES",
      timestamps: false,
      indexes: [
        { fields: ["doc_id"], name: "idx_retail_stock_doc_lines_doc" },
        { fields: ["product_id"], name: "idx_retail_stock_doc_lines_product" },
      ],
    },
  );

  return RetailStockDocumentLine;
};
