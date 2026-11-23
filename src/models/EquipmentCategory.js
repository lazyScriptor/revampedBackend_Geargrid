import { DataTypes } from "sequelize";

export default (sequelize) => {
  const EquipmentCategory = sequelize.define(
    "EquipmentCategory",
    {
      category_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      category_name: { type: DataTypes.STRING(150), allowNull: false },
      // Empty = top-level family. Only two levels: a sub-category's parent is always a top-level one.
      parent_id: { type: DataTypes.INTEGER, allowNull: true },
      // Exposed as `description` (what the API/UI sends); stored in the legacy category_description column.
      description: { type: DataTypes.TEXT, allowNull: true, field: "category_description" },
    },
    {
      tableName: "EQUIPMENT_CATEGORIES",
      timestamps: false,
    },
  );
  return EquipmentCategory;
};
