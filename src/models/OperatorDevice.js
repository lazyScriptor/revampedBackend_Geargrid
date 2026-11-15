import { DataTypes } from "sequelize";

export default (sequelize) => {
  const OperatorDevice = sequelize.define(
    "OperatorDevice",
    {
      operator_device_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      device_id: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      device_label: { type: DataTypes.STRING(100), allowNull: true },
      user_agent: { type: DataTypes.STRING(500), allowNull: true },
      last_seen_at: { type: DataTypes.DATE, allowNull: true },
      paired_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      token_hash: { type: DataTypes.STRING(64), allowNull: true },
      token_issued_at: { type: DataTypes.DATE, allowNull: true },
      app_version: { type: DataTypes.STRING(20), allowNull: true },
      contacts_synced_at: { type: DataTypes.DATE, allowNull: true },
      briefs_synced_at: { type: DataTypes.DATE, allowNull: true },
      is_native_app: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      contact_sync_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      push_token: { type: DataTypes.STRING(512), allowNull: true },
      push_token_updated_at: { type: DataTypes.DATE, allowNull: true },
      status: {
        type: DataTypes.ENUM("PENDING", "ACTIVE", "SUSPENDED", "REVOKED"),
        allowNull: false,
        defaultValue: "ACTIVE",
      },
      capabilities: { type: DataTypes.JSON, allowNull: true },
      brief_profile_id: { type: DataTypes.STRING(40), allowNull: true },
      contact_sync_mode: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "off" },
      call_logging_scope: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: "customers_and_contacts",
      },
      sim_filter: { type: DataTypes.STRING(64), allowNull: true },
      device_model: { type: DataTypes.STRING(100), allowNull: true },
      os_version: { type: DataTypes.STRING(20), allowNull: true },
      reported_state: { type: DataTypes.JSON, allowNull: true },
      muted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      approved_by: { type: DataTypes.INTEGER, allowNull: true },
      approved_at: { type: DataTypes.DATE, allowNull: true },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      prev_token_hash: { type: DataTypes.STRING(64), allowNull: true },
      prev_token_expires_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "OPERATOR_DEVICES",
      timestamps: true,
      indexes: [
        { fields: ["user_id"] },
        { fields: ["device_id"] },
        { fields: ["last_seen_at"] },
        { fields: ["status"] },
      ],
    },
  );
  return OperatorDevice;
};
