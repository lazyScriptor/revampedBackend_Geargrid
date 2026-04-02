import * as permissionService from '../services/permissionService.js';
import { getCachedTenantConnection } from '../config/database.js';
import { initTenantModels } from '../models/index.js';
import catchAsync from '../utils/catchAsync.js';

export const getPermissions = catchAsync(async (req, res, next) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  const models = initTenantModels(connection);

  const permissions = await permissionService.getAllPermissions(models);
  res.status(200).json({ status: 'success', data: { permissions } });
});