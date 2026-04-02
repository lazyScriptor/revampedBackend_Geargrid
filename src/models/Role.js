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
    },
    {
      tableName: "ROLES",
      timestamps: false,
    },
  );
  return Role;
};
