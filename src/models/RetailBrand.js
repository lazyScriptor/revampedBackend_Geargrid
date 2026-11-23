import { DataTypes } from "sequelize";

export default (sequelize) => {
  const RetailBrand = sequelize.define(
    "RetailBrand",
    {
      brand_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      logo_url: { type: DataTypes.STRING(500), allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      tableName: "RETAIL_BRANDS",
      timestamps: true,
    },
  );

  return RetailBrand;
};
