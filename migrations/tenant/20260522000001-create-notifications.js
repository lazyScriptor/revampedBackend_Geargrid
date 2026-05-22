import { DataTypes } from "sequelize";

export const up = async ({ context: queryInterface }) => {
  await queryInterface.createTable("NOTIFICATIONS", {
    notification_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    user_id: { type: DataTypes.INTEGER, allowNull: false },
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
    category: { type: DataTypes.STRING(40), allowNull: true },
    title: { type: DataTypes.STRING(160), allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: true },
    payload: { type: DataTypes.JSON, allowNull: true },
    link: { type: DataTypes.STRING(255), allowNull: true },
    read_at: { type: DataTypes.DATE, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  await queryInterface.addIndex("NOTIFICATIONS", ["user_id", "createdAt"]);
  await queryInterface.addIndex("NOTIFICATIONS", ["user_id", "read_at"]);
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.dropTable("NOTIFICATIONS");
};
