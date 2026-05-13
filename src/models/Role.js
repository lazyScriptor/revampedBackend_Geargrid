import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Role = sequelize.define(
    "Role",
    {
      role_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      role_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      description: { type: DataTypes.TEXT, allowNull: true },
      is_system_default: { type: DataTypes.BOOLEAN, defaultValue: false },
      hierarchy_level: { type: DataTypes.INTEGER, defaultValue: 10 },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    },
    {
      tableName: "ROLES",
      timestamps: false,
    },
  );
  return Role;
};
