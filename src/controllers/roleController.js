import * as roleService from "../services/roleService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

export const createRole = catchAsync(async (req, res, next) => {
  const { roleName, description, hierarchyLevel } = req.body;
  const reqUserHierarchy = req.user.roleHierarchyLevel || 0;

  const newRole = await roleService.createRole(
    getModels(req),
    roleName,
    description,
    hierarchyLevel,
    reqUserHierarchy
  );
  res.status(201).json({ status: "success", data: { role: newRole } });
});

export const updateRole = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const reqUserHierarchy = req.user.roleHierarchyLevel || 0;

  const role = await roleService.updateRole(getModels(req), id, req.body, reqUserHierarchy);
  res.status(200).json({ status: "success", message: "Role updated successfully.", data: { role } });
});

export const deleteRole = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const reqUserHierarchy = req.user.roleHierarchyLevel || 0;

  const role = await roleService.deleteRole(getModels(req), id, reqUserHierarchy);
  res.status(200).json({ status: "success", message: "Role deactivated successfully.", data: { role } });
});

export const getRoles = catchAsync(async (req, res, next) => {
  const showInactive = req.query.showInactive === 'true';
  const roles = await roleService.getAllRolesWithPermissions(getModels(req), showInactive);
  res.status(200).json({ status: "success", data: { roles } });
});

export const assignPermissions = catchAsync(async (req, res, next) => {
  const { id } = req.params; // Role ID
  const { permissionIds } = req.body; // Array of permission UUIDs
  const reqUserHierarchy = req.user.roleHierarchyLevel || 0;

  const role = await roleService.updateRolePermissions(
    getModels(req),
    id,
    permissionIds,
    reqUserHierarchy
  );
  
  res.status(200).json({
    status: "success",
    message: "Permissions updated successfully.",
    data: { role },
  });
});

export const assignUsers = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { userIds } = req.body;
  const reqUserHierarchy = req.user.roleHierarchyLevel || 0;

  const role = await roleService.assignUsersToRole(getModels(req), id, userIds, reqUserHierarchy);
  res.status(200).json({
    status: "success",
    message: "Users assigned to role successfully.",
    data: { role },
  });
});

export const getUsersForRole = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const users = await roleService.getUsersForRole(getModels(req), id);
  res.status(200).json({ status: "success", data: { users } });
});
