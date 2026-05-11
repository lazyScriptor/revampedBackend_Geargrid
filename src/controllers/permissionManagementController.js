import * as permissionManagementService from "../services/permissionManagementService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

export const getPermissionMatrix = catchAsync(async (req, res) => {
  const data = await permissionManagementService.getPermissionMatrix(
    getModels(req),
  );
  res.status(200).json({ status: "success", data });
});

export const setUserOverride = catchAsync(async (req, res) => {
  const { userId, permissionId, grantType } = req.body;
  const override = await permissionManagementService.setUserPermissionOverride(
    getModels(req),
    userId,
    permissionId,
    grantType,
  );
  res.status(200).json({ status: "success", data: { override } });
});

export const removeUserOverride = catchAsync(async (req, res) => {
  const { userId, permissionId } = req.body;
  await permissionManagementService.removeUserPermissionOverride(
    getModels(req),
    userId,
    permissionId,
  );
  res
    .status(200)
    .json({ status: "success", message: "Override removed." });
});

export const cloneRolePermissions = catchAsync(async (req, res) => {
  const { sourceRoleId, targetRoleId } = req.body;
  const result = await permissionManagementService.cloneRolePermissions(
    getModels(req),
    sourceRoleId,
    targetRoleId,
  );
  res.status(200).json({ status: "success", data: result });
});

export const getUserEffectivePermissions = catchAsync(async (req, res) => {
  const perms = await permissionManagementService.getUserEffectivePermissions(
    getModels(req),
    req.params.userId,
  );
  res.status(200).json({ status: "success", data: { permissions: perms } });
});
