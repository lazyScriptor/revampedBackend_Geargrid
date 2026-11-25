import { DataTypes } from "sequelize";

export default (sequelize) => {
  const UserUiPreference = sequelize.define(
    "UserUiPreference",
    {
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      pref_key: {
        type: DataTypes.STRING(60),
        allowNull: false,
        primaryKey: true,
      },
      value: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "USER_UI_PREFERENCES",
      timestamps: true,
      createdAt: false,
    },
  );

  return UserUiPreference;
};
