import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Tenant = sequelize.define(
    "Tenant",
    {
      tenant_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      db_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      db_user: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      encrypted_db_pass: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      db_host: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: "localhost",
      },
      // --- SaaS Management Fields ---
      subscription_status: {
        type: DataTypes.ENUM("Active", "Suspended", "Overdue"),
        allowNull: false,
        defaultValue: "Active",
      },
      tier: {
        type: DataTypes.ENUM("Basic", "Pro", "Enterprise"),
        allowNull: false,
        defaultValue: "Basic",
      },
      max_users: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 25,
      },
      feature_flags: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {
          continuous_return: true,
          accounting_module: true,
          bulk_import: true,
          maintenance_module: true,
        },
      },
    },
    {
      tableName: "TENANTS",
      timestamps: true,
    },
  );
  return Tenant;
};
