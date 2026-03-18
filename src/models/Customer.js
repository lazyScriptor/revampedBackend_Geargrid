import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const Customer = sequelize.define(
  "Customer",
  {
    cus_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    cus_fname: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    cus_lname: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    nic: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    cus_phone_number: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    cus_address1: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    cus_address2: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    cus_parent_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "customer", key: "cus_id" },
    },
    cus_delete_status: {
      type: DataTypes.TINYINT,
      defaultValue: 0,
    },
  },
  {
    tableName: "customer",
    timestamps: false, // You aren't using created_at/updated_at yet
  },
);

export default Customer;
