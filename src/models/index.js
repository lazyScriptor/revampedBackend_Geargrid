import User from './User.js';
import Role from './Role.js';
import UserRoleMap from './UserRoleMap.js';
import Customer from './Customer.js';

// User & Role Relations
User.belongsToMany(Role, { through: UserRoleMap, foreignKey: 'urm_userid', otherKey: 'urm_roleid' });
Role.belongsToMany(User, { through: UserRoleMap, foreignKey: 'urm_roleid', otherKey: 'urm_userid' });

// Customer Self-Referencing Relation (Parent -> Children)
Customer.hasMany(Customer, { as: 'Children', foreignKey: 'cus_parent_id' });
Customer.belongsTo(Customer, { as: 'Parent', foreignKey: 'cus_parent_id' });

export { User, Role, UserRoleMap, Customer };