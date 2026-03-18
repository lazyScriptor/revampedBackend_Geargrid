import User from "./User.js";
import Role from "./Role.js";
import UserRoleMap from "./UserRoleMap.js";

// A User belongs to many Roles through UserRoleMap
User.belongsToMany(Role, {
  through: UserRoleMap,
  foreignKey: "urm_userid",
  otherKey: "urm_roleid",
});
// A Role belongs to many Users through UserRoleMap
Role.belongsToMany(User, {
  through: UserRoleMap,
  foreignKey: "urm_roleid",
  otherKey: "urm_userid",
});

export { User, Role, UserRoleMap };
