import AppError from "../utils/AppError.js";

/**
 * Get full permission matrix: all roles with their permissions + all user overrides.
 */
export const getPermissionMatrix = async (models) => {
  // All permissions (the catalog)
  const permissions = await models.Permission.findAll({
    order: [["module_name", "ASC"], ["permission_code", "ASC"]],
    raw: true,
  });

  // All roles with their permissions
  const roles = await models.Role.findAll({
    include: [
      {
        model: models.Permission,
        attributes: ["permission_id", "permission_code"],
        through: { attributes: [] },
      },
    ],
  });

  // All user-level overrides
  const overrides = await models.UserPermissionOverride.findAll({
    include: [
      { model: models.User, attributes: ["user_id", "username"] },
      { model: models.Permission, attributes: ["permission_id", "permission_code"] },
    ],
  });

  // All users (for the user columns in the matrix)
  const users = await models.User.findAll({
    attributes: ["user_id", "username", "first_name", "last_name", "is_active"],
    include: [
      {
        model: models.Role,
        attributes: ["role_id", "role_name"],
        through: { attributes: [] },
      },
    ],
    where: { is_active: true },
  });

  return { permissions, roles, overrides, users };
};

/**
 * Set a user-level permission override (grant or revoke).
 */
export const setUserPermissionOverride = async (
  models,
  userId,
  permissionId,
  grantType,
) => {
  const user = await models.User.findByPk(userId);
  if (!user) throw new AppError(`User with ID ${userId} was not found in this tenant.`, 404);

  const permission = await models.Permission.findByPk(permissionId);
  if (!permission) throw new AppError(`Permission with ID ${permissionId} does not exist. It may have been deleted.`, 404);

  // Upsert: create or update the override
  const [override, created] = await models.UserPermissionOverride.findOrCreate({
    where: { user_id: userId, permission_id: permissionId },
    defaults: { grant_type: grantType },
  });

  if (!created) {
    await override.update({ grant_type: grantType });
  }

  return override;
};

/**
 * Remove a user-level permission override (revert to role default).
 */
export const removeUserPermissionOverride = async (
  models,
  userId,
  permissionId,
) => {
  const deleted = await models.UserPermissionOverride.destroy({
    where: { user_id: userId, permission_id: permissionId },
  });

  if (deleted === 0) {
    throw new AppError("No override exists for this user and permission combination. Nothing to remove.", 404);
  }

  return true;
};

/**
 * Clone all permissions from one role to another.
 */
export const cloneRolePermissions = async (models, sourceRoleId, targetRoleId) => {
  const sourceRole = await models.Role.findByPk(sourceRoleId, {
    include: [{ model: models.Permission, through: { attributes: [] } }],
  });
  if (!sourceRole) throw new AppError(`Source role (ID: ${sourceRoleId}) was not found.`, 404);

  const targetRole = await models.Role.findByPk(targetRoleId);
  if (!targetRole) throw new AppError(`Target role (ID: ${targetRoleId}) was not found.`, 404);

  const permissionIds = sourceRole.Permissions.map((p) => p.permission_id);
  await targetRole.setPermissions(permissionIds);

  return { cloned: permissionIds.length, from: sourceRole.role_name, to: targetRole.role_name };
};

/**
 * Compute the effective permission set for a user (role + grants - revokes).
 */
export const getUserEffectivePermissions = async (models, userId) => {
  const user = await models.User.findByPk(userId, {
    include: [
      {
        model: models.Role,
        through: { attributes: [] },
        include: [
          {
            model: models.Permission,
            attributes: ["permission_id", "permission_code", "module_name"],
            through: { attributes: [] },
          },
        ],
      },
    ],
  });

  if (!user) throw new AppError(`User with ID ${userId} was not found in this tenant.`, 404);

  // Role-based permissions
  const rolePerms = new Map();
  user.Roles?.forEach((role) => {
    role.Permissions?.forEach((perm) => {
      rolePerms.set(perm.permission_code, perm);
    });
  });

  // User overrides
  const overrides = await models.UserPermissionOverride.findAll({
    where: { user_id: userId },
    include: [
      { model: models.Permission, attributes: ["permission_id", "permission_code", "module_name"] },
    ],
  });

  const effective = new Map(rolePerms);
  for (const o of overrides) {
    const code = o.Permission?.permission_code;
    if (!code) continue;
    if (o.grant_type === "grant") {
      effective.set(code, o.Permission);
    } else if (o.grant_type === "revoke") {
      effective.delete(code);
    }
  }

  return Array.from(effective.values());
};
