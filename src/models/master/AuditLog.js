import { DataTypes } from "sequelize";

export default (sequelize) => {
  const AuditLog = sequelize.define(
    "AuditLog",
    {
      log_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      super_admin_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      action: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      target_tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      target_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      ip_address: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      tableName: "SUPER_ADMIN_AUDIT_LOG",
      timestamps: true,
    },
  );
  return AuditLog;
};
