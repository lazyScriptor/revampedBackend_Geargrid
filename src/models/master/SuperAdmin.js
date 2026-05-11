import { DataTypes } from "sequelize";

export default (sequelize) => {
  const SuperAdmin = sequelize.define(
    "SuperAdmin",
    {
      super_admin_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      password_hash: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      display_name: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName: "SUPER_ADMINS",
      timestamps: true,
    },
  );
  return SuperAdmin;
};
