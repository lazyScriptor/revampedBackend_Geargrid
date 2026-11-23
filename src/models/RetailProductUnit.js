import { DataTypes } from "sequelize";

export default (sequelize) => {
  const RetailProductUnit = sequelize.define(
    "RetailProductUnit",
    {
      unit_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      product_id: { type: DataTypes.INTEGER, allowNull: false },
      unit_name: { type: DataTypes.STRING(20), allowNull: false },
      factor: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
      sell_price: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      is_default_sale: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "RETAIL_PRODUCT_UNITS",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["product_id", "unit_name"],
          name: "uq_retail_product_units_product_name",
        },
      ],
    },
  );

  return RetailProductUnit;
};
