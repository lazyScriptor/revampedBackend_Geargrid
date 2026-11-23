import { DataTypes } from "sequelize";

export const RETAIL_SERIAL_STATUSES = ["in_stock", "sold", "returned", "written_off"];

export default (sequelize) => {
  const RetailSerial = sequelize.define(
    "RetailSerial",
    {
      serial_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      product_id: { type: DataTypes.INTEGER, allowNull: false },
      serial_no: { type: DataTypes.STRING(80), allowNull: false },
      warehouse_id: { type: DataTypes.INTEGER, allowNull: false },
      status: {
        type: DataTypes.ENUM(...RETAIL_SERIAL_STATUSES),
        allowNull: false,
        defaultValue: "in_stock",
      },
      receive_doc_id: { type: DataTypes.INTEGER, allowNull: true },
      sale_line_id: { type: DataTypes.INTEGER, allowNull: true },
      sold_at: { type: DataTypes.DATE, allowNull: true },
      warranty_end: { type: DataTypes.DATEONLY, allowNull: true },
    },
    {
      tableName: "RETAIL_SERIALS",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["product_id", "serial_no"],
          name: "uq_retail_serials_product_no",
        },
        {
          fields: ["warehouse_id", "status"],
          name: "idx_retail_serials_wh_status",
        },
      ],
    },
  );

  return RetailSerial;
};
