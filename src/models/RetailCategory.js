import { DataTypes } from "sequelize";

export default (sequelize) => {
  const RetailCategory = sequelize.define(
    "RetailCategory",
    {
      category_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      parent_id: { type: DataTypes.INTEGER, allowNull: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
      name_si: { type: DataTypes.STRING(150), allowNull: true },
      item_name: { type: DataTypes.STRING(150), allowNull: true },
      item_name_si: { type: DataTypes.STRING(150), allowNull: true },
      image_url: { type: DataTypes.STRING(500), allowNull: true },
      icon: { type: DataTypes.STRING(40), allowNull: true },
      usual_sizes: { type: DataTypes.JSON, allowNull: true },
      attributes: { type: DataTypes.JSON, allowNull: true },
      default_unit: { type: DataTypes.STRING(12), allowNull: true },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      tableName: "RETAIL_CATEGORIES",
      timestamps: true,
      indexes: [
        { fields: ["parent_id"], name: "idx_retail_categories_parent" },
        { fields: ["is_active"], name: "idx_retail_categories_active" },
      ],
    },
  );

  return RetailCategory;
};
