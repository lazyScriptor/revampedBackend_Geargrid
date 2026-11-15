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
      push_token: { type: DataTypes.STRING(255), allowNull: true },
      push_token_updated_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "OPERATOR_DEVICES",
      timestamps: true,
      indexes: [
        { fields: ["user_id"] },
        { fields: ["device_id"] },
        { fields: ["last_seen_at"] },
      ],
    },
  );
  return OperatorDevice;
};
