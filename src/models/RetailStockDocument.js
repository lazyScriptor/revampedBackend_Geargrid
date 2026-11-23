import { DataTypes } from "sequelize";

export const STOCK_DOC_TYPES = ["opening", "receive", "adjust", "count", "transfer"];
export const STOCK_DOC_STATUSES = ["draft", "posted"];

export default (sequelize) => {
  const RetailStockDocument = sequelize.define(
    "RetailStockDocument",
    {
      doc_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      doc_type: {
        type: DataTypes.ENUM(...STOCK_DOC_TYPES),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...STOCK_DOC_STATUSES),
        allowNull: false,
        defaultValue: "draft",
      },
      doc_no: { type: DataTypes.STRING(20), allowNull: false },
      warehouse_id: { type: DataTypes.INTEGER, allowNull: false },
      to_warehouse_id: { type: DataTypes.INTEGER, allowNull: true },
      supplier_name: { type: DataTypes.STRING(160), allowNull: true },
      supplier_ref: { type: DataTypes.STRING(80), allowNull: true },
      reason: { type: DataTypes.STRING(40), allowNull: true },
      note: { type: DataTypes.STRING(500), allowNull: true },
      delivery_charge: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total_cost: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      user_id: { type: DataTypes.INTEGER, allowNull: true },
      occurred_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      posted_at: { type: DataTypes.DATE, allowNull: true },
      version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
    },
    {
      tableName: "RETAIL_STOCK_DOCUMENTS",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["doc_type", "doc_no"],
          name: "uq_retail_stock_docs_type_no",
        },
        {
          fields: ["doc_type", "status", "occurred_at"],
          name: "idx_retail_stock_docs_type_status_date",
        },
        {
          fields: ["supplier_name"],
          name: "idx_retail_stock_docs_supplier",
        },
      ],
    },
  );

  return RetailStockDocument;
};
