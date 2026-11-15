import { DataTypes } from "sequelize";

export default (sequelize) => {
  const DeviceRegistry = sequelize.define(
    "DeviceRegistry",
    {
      device_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        primaryKey: true,
      },
      // Matches master.TENANTS.tenant_id (UUID STRING(36)).
      tenant_id: {
        type: DataTypes.STRING(36),
        allowNull: false,
      },
    },
    {
      tableName: "DEVICE_REGISTRY",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [{ fields: ["tenant_id"] }],
    },
  );
  return DeviceRegistry;
};
