import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const Role = sequelize.define(
  "Role",
  {
    ur_roleid: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    ur_role: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    tableName: "userRole",
    timestamps: false,
  },
);

export default Role;
