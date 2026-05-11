import { DataTypes } from "sequelize";

export default (sequelize) => {
  const UserPermissionOverride = sequelize.define(
    "UserPermissionOverride",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      permission_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      grant_type: {
        type: DataTypes.ENUM("grant", "revoke"),
        allowNull: false,
      },
    },
    {
      tableName: "USER_PERMISSION_OVERRIDES",
      timestamps: true,
      indexes: [
        {
          unique: true,
          name: "upo_user_perm_unique",
          fields: ["user_id", "permission_id"],
        },
      ],
    },
  );
  return UserPermissionOverride;
};
