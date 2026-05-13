import AppError from "../utils/AppError.js";
import { Op } from "sequelize";

export const createRole = async (models, roleName, description, hierarchyLevel, reqUserHierarchy = 0) => {
  if (reqUserHierarchy <= hierarchyLevel && reqUserHierarchy !== 100) {
    throw new AppError("You cannot create a role with a hierarchy level equal to or higher than your own.", 403);
  }

  const existingRole = await models.Role.findOne({ where: { role_name: roleName } });
  if (existingRole) throw new AppError("Role name already exists.", 400);

  return await models.Role.create({
    role_name: roleName,
    description: description,
    hierarchy_level: hierarchyLevel || 10,
    is_system_default: false,
    is_active: true
  });
};

export const updateRole = async (models, roleId, payload, reqUserHierarchy = 0) => {
  const role = await models.Role.findByPk(roleId);
  if (!role) throw new AppError("Role not found.", 404);

  if (reqUserHierarchy <= role.hierarchy_level && reqUserHierarchy !== 100) {
    throw new AppError("You cannot modify a role with a hierarchy level equal to or higher than your own.", 403);
  }

  if (payload.hierarchy_level && reqUserHierarchy <= payload.hierarchy_level && reqUserHierarchy !== 100) {
    throw new AppError("You cannot elevate a role's hierarchy to be equal to or higher than your own.", 403);
  }

  if (role.is_system_default) {
    throw new AppError("System default roles cannot be modified.", 403);
  }

  await role.update(payload);
  return role;
};

export const deleteRole = async (models, roleId, reqUserHierarchy = 0) => {
  const role = await models.Role.findByPk(roleId);
  if (!role) throw new AppError("Role not found.", 404);

  if (reqUserHierarchy <= role.hierarchy_level && reqUserHierarchy !== 100) {
    throw new AppError("You cannot delete a role with a hierarchy level equal to or higher than your own.", 403);
  }

  if (role.is_system_default) {
    throw new AppError("System default roles cannot be deleted.", 403);
  }

  role.is_active = false;
  await role.save();
  return role;
};

export const getAllRolesWithPermissions = async (models, showInactive = false) => {
  const whereClause = showInactive ? {} : { is_active: true };
  return await models.Role.findAll({
    where: whereClause,
    include: [
      {
        model: models.Permission,
        attributes: ["permission_id", "permission_code", "module_name"],
        through: { attributes: [] },
      },
    ],
  });
};

export const updateRolePermissions = async (models, roleId, permissionIds, reqUserHierarchy = 0) => {
  const role = await models.Role.findByPk(roleId);
  if (!role) throw new AppError("Role not found.", 404);
  
  if (reqUserHierarchy <= role.hierarchy_level && reqUserHierarchy !== 100) {
    throw new AppError("You cannot modify permissions of a role with a hierarchy level equal to or higher than your own.", 403);
  }

  if (role.is_system_default) {
    throw new AppError(
      `The "${role.role_name}" role is a system default and its permissions cannot be modified directly. To adjust permissions for a specific user in this role, use user-level overrides in the Permission Matrix instead.`,
      403,
    );
  }

  await role.setPermissions(permissionIds);
  return role;
};
