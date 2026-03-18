import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const UserRoleMap = sequelize.define(
  "UserRoleMap",
  {
    urm_userid: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      references: { model: "users", key: "user_id" },
    },
    urm_roleid: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      references: { model: "userRole", key: "ur_roleid" },
    },
    urm_password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    tableName: "userRoleMap",
    timestamps: false,
  },
);

export default UserRoleMap;
