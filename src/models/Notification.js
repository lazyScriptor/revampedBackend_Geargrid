import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Notification = sequelize.define(
    "Notification",
    {
      notification_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM(
          "bulk_job",
          "info",
          "success",
          "warning",
          "error",
          "system",
        ),
        allowNull: false,
        defaultValue: "info",
      },
      category: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      title: {
        type: DataTypes.STRING(160),
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      payload: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      link: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      read_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "NOTIFICATIONS",
      timestamps: true,
      indexes: [
        { fields: ["user_id", "createdAt"] },
        { fields: ["user_id", "read_at"] },
      ],
    },
  );

  return Notification;
};
