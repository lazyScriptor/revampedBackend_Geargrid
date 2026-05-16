import { DataTypes } from "sequelize";

export default (sequelize) => {
  const PlatformConfig = sequelize.define(
    "PlatformConfig",
    {
      config_key: {
        type: DataTypes.STRING(100),
        primaryKey: true,
      },
      config_value: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "PLATFORM_CONFIG",
      timestamps: false,
    },
  );
  return PlatformConfig;
};
