import * as warehouseService from '../services/warehouseService.js';
import { getCachedTenantConnection } from '../config/database.js';
import { initTenantModels } from '../models/index.js';
import catchAsync from '../utils/catchAsync.js';

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

export const createWarehouse = catchAsync(async (req, res, next) => {
  const { locationName, address, managerUserId } = req.body;
  
  const warehouse = await warehouseService.createWarehouse(getModels(req), locationName, address, managerUserId);
  res.status(201).json({ status: 'success', data: { warehouse } });
});

export const getWarehouses = catchAsync(async (req, res, next) => {
  const warehouses = await warehouseService.getAllWarehouses(getModels(req));
  res.status(200).json({ status: 'success', data: { warehouses } });
});