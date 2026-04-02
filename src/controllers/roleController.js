import * as roleService from "../services/roleService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

export const createRole = catchAsync(async (req, res, next) => {
    const { roleName, description } = req.body;
  const newRole = await roleService.createRole(
    getModels(req),
    roleName,
    description,
  );
  res.status(201).json({ status: "success", data: { role: newRole } });
});

export const getRoles = catchAsync(async (req, res, next) => {
  const roles = await roleService.getAllRolesWithPermissions(getModels(req));
  res.status(200).json({ status: "success", data: { roles } });
});

export const assignPermissions = catchAsync(async (req, res, next) => {
  const { id } = req.params; // Role ID
  const { permissionIds } = req.body; // Array of permission UUIDs

  const role = await roleService.updateRolePermissions(
    getModels(req),
    id,
    permissionIds,
  );
  res
    .status(200)
    .json({
      status: "success",
      message: "Permissions updated successfully.",
      data: { role },
    });
});
