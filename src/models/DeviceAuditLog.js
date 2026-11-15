import { DataTypes } from "sequelize";

export default (sequelize) => {
  const DeviceAuditLog = sequelize.define(
    "DeviceAuditLog",
    {
      audit_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      operator_device_id: { type: DataTypes.INTEGER, allowNull: false },
      actor_user_id: { type: DataTypes.INTEGER, allowNull: true },
      action: { type: DataTypes.STRING(40), allowNull: false },
      detail: { type: DataTypes.JSON, allowNull: true },
    },
    {
      tableName: "DEVICE_AUDIT_LOGS",
      timestamps: true,
      indexes: [
        { fields: ["operator_device_id"] },
        { fields: ["createdAt"] },
      ],
    },
  );
  return DeviceAuditLog;
};
