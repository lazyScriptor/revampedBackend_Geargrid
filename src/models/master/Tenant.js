import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Tenant = sequelize.define(
    "Tenant",
    {
      tenant_id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
      },
      db_name: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      db_user: { type: DataTypes.STRING(255), allowNull: false },
      encrypted_db_pass: { type: DataTypes.STRING(255), allowNull: false },
      db_host: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: "localhost",
      },
      // --- Identity / Contact ---
      display_name: { type: DataTypes.STRING(255), allowNull: true },
      contact_email: { type: DataTypes.STRING(255), allowNull: true },
      contact_phone: { type: DataTypes.STRING(50), allowNull: true },
      // --- Billing ---
      monthly_rate: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      next_billing_date: { type: DataTypes.DATEONLY, allowNull: true },
      // --- Access Control ---
      cors_whitelist: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: [],
      },
      // --- Branding ---
      branding: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {
          primaryColor: "#1e40af",
          secondaryColor: "#0f172a",
          accentColor: "#3b82f6",
          logoUrl: null,
          businessName: null,
        },
      },
      // --- Internal ---
      internal_notes: { type: DataTypes.TEXT, allowNull: true },
      // --- Localization ---
      // ISO 639-1 code. Defaults to Sinhala per GearGrid policy; super admin
      // can override per tenant. Frontend resolves: user.language > this >
      // platform fallback ("si"), then loads the matching pack from
      // /api/i18n/pack/:lang.
      default_language: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: "si",
      },
      // --- SaaS Management ---
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
