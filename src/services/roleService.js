import AppError from "../utils/AppError.js";

export const createRole = async (models, roleName, description) => {
  const existingRole = await models.Role.findOne({
    where: { role_name: roleName },
  });
  if (existingRole) throw new AppError("Role name already exists.", 400);

  return await models.Role.create({
    role_name: roleName,
    description: description,
    is_system_default: false, // Custom roles created by the client are never system defaults
  });
};

export const getAllRolesWithPermissions = async (models) => {
  return await models.Role.findAll({
    include: [
      {
        model: models.Permission,
        attributes: ["permission_id", "permission_code", "module_name"],
        through: { attributes: [] },
      },
    ],
  });
};

export const updateRolePermissions = async (models, roleId, permissionIds) => {
  const role = await models.Role.findByPk(roleId);
  if (!role) throw new AppError("Role not found.", 404);
  if (role.is_system_default)
    throw new AppError("Cannot modify system default roles.", 403);

  // This automatically syncs the ROLE_PERMISSIONS junction table
  await role.setPermissions(permissionIds);

  return role;
};
