import { DataTypes } from "sequelize";

export default (sequelize) => {
  const DevicePairingCode = sequelize.define(
    "DevicePairingCode",
    {
      pairing_code_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      code: { type: DataTypes.STRING(16), allowNull: false, unique: true },
      // tenant_id matches master.TENANTS.tenant_id (UUID stored as STRING(36)).
      tenant_id: { type: DataTypes.STRING(36), allowNull: false },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      status: {
        type: DataTypes.ENUM("PENDING", "CLAIMED", "EXPIRED"),
        allowNull: false,
        defaultValue: "PENDING",
      },
      claimed_device_id: { type: DataTypes.STRING(64), allowNull: true },
      claimed_at: { type: DataTypes.DATE, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      tableName: "DEVICE_PAIRING_CODES",
      timestamps: true,
      indexes: [
        { fields: ["code"] },
        { fields: ["tenant_id"] },
        { fields: ["status"] },
        { fields: ["expires_at"] },
      ],
    },
  );
  return DevicePairingCode;
};
