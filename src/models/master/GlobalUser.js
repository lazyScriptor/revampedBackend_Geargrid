import { DataTypes } from "sequelize";

export default (sequelize) => {
  const GlobalUser = sequelize.define(
    "GlobalUser",
    {
      global_user_id: {
        type: DataTypes.INTEGER,
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
      target_tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      tableName: "GLOBAL_USERS",
      timestamps: false,
    },
  );
  return GlobalUser;
};
