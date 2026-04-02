import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Permission = sequelize.define(
    "Permission",
    {
      permission_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      permission_code: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      module_name: { type: DataTypes.STRING(100), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "PERMISSIONS",
      timestamps: false,
    },
  );
  return Permission;
};
