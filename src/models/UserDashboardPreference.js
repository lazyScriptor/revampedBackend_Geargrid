import { DataTypes } from "sequelize";

export default (sequelize) => {
  const UserDashboardPreference = sequelize.define(
    "UserDashboardPreference",
    {
      preference_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      custom_layout_json: { type: DataTypes.JSON, allowNull: true },
      saved_filters_json: { type: DataTypes.JSON, allowNull: true, defaultValue: {} },
      last_synced_at: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: "USER_DASHBOARD_PREFERENCES", timestamps: true },
  );
  return UserDashboardPreference;
};
