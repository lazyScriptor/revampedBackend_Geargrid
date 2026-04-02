import * as userService from '../services/userService.js';
import { getCachedTenantConnection } from '../config/database.js';
import { initTenantModels } from '../models/index.js';
import catchAsync from '../utils/catchAsync.js';

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

export const getUsers = catchAsync(async (req, res, next) => {
  const users = await userService.getAllUsers(getModels(req));
  res.status(200).json({ status: 'success', data: { users } });
});

export const toggleUserStatus = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { isActive } = req.body; // boolean
  
  const updatedUser = await userService.updateUserStatus(getModels(req), id, isActive);
  res.status(200).json({ status: 'success', data: { user: updatedUser } });
});

export const assignRoles = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { roleIds } = req.body; // Array of role UUIDs
  
  const user = await userService.assignUserRoles(getModels(req), id, roleIds);
  res.status(200).json({ status: 'success', data: { user } });
});