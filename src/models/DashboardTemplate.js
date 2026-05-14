import { DataTypes } from "sequelize";

export default (sequelize) => {
  const DashboardTemplate = sequelize.define(
    "DashboardTemplate",
    {
      template_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      template_name: { type: DataTypes.STRING(255), allowNull: false },
      role_id: { type: DataTypes.INTEGER, allowNull: true },
      layout_json: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
      created_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    },
    { tableName: "DASHBOARD_TEMPLATES", timestamps: true },
  );
  return DashboardTemplate;
};
