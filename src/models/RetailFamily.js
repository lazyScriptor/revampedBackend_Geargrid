import { DataTypes } from "sequelize";

export default (sequelize) => {
  const RetailFamily = sequelize.define(
    "RetailFamily",
    {
      family_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: { type: DataTypes.STRING(200), allowNull: false },
      name_si: { type: DataTypes.STRING(200), allowNull: true },
      category_id: { type: DataTypes.INTEGER, allowNull: false },
      brand_id: { type: DataTypes.INTEGER, allowNull: true },
      option_label: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: "Size",
      },
      option_unit: { type: DataTypes.STRING(10), allowNull: true },
    },
    {
      tableName: "RETAIL_FAMILIES",
      timestamps: true,
      indexes: [
        { fields: ["category_id"], name: "idx_retail_families_category" },
        { fields: ["brand_id"], name: "idx_retail_families_brand" },
      ],
    },
  );

  return RetailFamily;
};
