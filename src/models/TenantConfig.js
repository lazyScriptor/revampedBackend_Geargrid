import { DataTypes } from "sequelize";

export default (sequelize) => {
  const TenantConfig = sequelize.define(
    "TenantConfig",
    {
      config_id: {
        type: DataTypes.STRING(36),
        allowNull: false,
        primaryKey: true,
      },
      business_display_name: { type: DataTypes.STRING(255), allowNull: false },
      primary_color: { type: DataTypes.STRING(7), defaultValue: "#1976d2" },
      secondary_color: { type: DataTypes.STRING(7), defaultValue: "#9c27b0" },
      logo_url: { type: DataTypes.TEXT, allowNull: true },
      currency_code: { type: DataTypes.STRING(10), defaultValue: "LKR" },
      timezone: { type: DataTypes.STRING(50), defaultValue: "Asia/Colombo" },
      custom_settings: { type: DataTypes.JSON, allowNull: true },
      status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: 1 },
    },
    {
      tableName: "TENANT_CONFIG",
      timestamps: true,
    },
  );
  return TenantConfig;
};
