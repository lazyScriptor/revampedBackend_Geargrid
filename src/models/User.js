import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const User = sequelize.define(
  "User",
  {
    user_id: {
      type: DataTypes.TINYINT, // Mapped accurately to tinyint(2) from your SQL dump
      primaryKey: true,
      autoIncrement: true,
    },
    user_first_name: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    user_last_name: {
      type: DataTypes.STRING(20),
      allowNull: true, // DEFAULT NULL in SQL
    },
    username: {
      type: DataTypes.STRING(15),
      allowNull: false,
      unique: true, // Essential for login fields
    },
    nic: {
      type: DataTypes.STRING(12),
      allowNull: false,
    },
    user_phone_number: {
      type: DataTypes.STRING(12),
      allowNull: false,
    },
    user_address1: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    user_address2: {
      type: DataTypes.STRING(30),
      allowNull: true, // DEFAULT NULL in SQL
    },
  },
  {
    tableName: "users",
    timestamps: false, // Set to false because your schema lacks created_at/updated_at columns
  },
);

export default User;
