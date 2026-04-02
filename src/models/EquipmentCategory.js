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
      category_description: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "EQUIPMENT_CATEGORIES",
      timestamps: false,
    },
  );
  return EquipmentCategory;
};
