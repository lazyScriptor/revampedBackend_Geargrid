import { DataTypes } from "sequelize";

export default (sequelize) => {
  const RetailBarcode = sequelize.define(
    "RetailBarcode",
    {
      barcode: {
        type: DataTypes.STRING(64),
        primaryKey: true,
      },
      product_id: { type: DataTypes.INTEGER, allowNull: false },
      unit_id: { type: DataTypes.INTEGER, allowNull: true },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "RETAIL_BARCODES",
      timestamps: false,
      indexes: [
        { fields: ["product_id"], name: "idx_retail_barcodes_product" },
      ],
    },
  );

  return RetailBarcode;
};
