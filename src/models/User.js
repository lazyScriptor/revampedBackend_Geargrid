import { DataTypes } from "sequelize";

export default (sequelize) => {
  const User = sequelize.define(
    "User",
    {
      user_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      warehouse_id: { type: DataTypes.INTEGER, allowNull: true },
      username: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      password_hash: { type: DataTypes.STRING(255), allowNull: false },
      first_name: { type: DataTypes.STRING(100), allowNull: false },
      last_name: { type: DataTypes.STRING(100), allowNull: false },
      nic_no: { type: DataTypes.STRING(20), allowNull: false, unique: true },
      phone_number: { type: DataTypes.STRING(50), allowNull: true },
      address_line1: { type: DataTypes.STRING(255), allowNull: true },
      address_line2: { type: DataTypes.STRING(255), allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    },
    {
      tableName: "USERS",
      timestamps: true, // Critical: Matches your SQL dump
    },
  );
  return User;
};
