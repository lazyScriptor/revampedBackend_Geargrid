import * as warehouseService from '../services/warehouseService.js';
import { getCachedTenantConnection } from '../config/database.js';
import { initTenantModels } from '../models/index.js';
import catchAsync from '../utils/catchAsync.js';

const getModels = (req) => initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

export const createWarehouse = catchAsync(async (req, res, next) => {
  const warehouse = await warehouseService.createWarehouse(getModels(req), req.body);
  res.status(201).json({ status: 'success', data: { warehouse } });
});

export const getWarehouses = catchAsync(async (req, res, next) => {
  const result = await warehouseService.getAllWarehouses(getModels(req), req.query);
  res.status(200).json({ status: 'success', data: result });
});

export const getSingleWarehouse = catchAsync(async (req, res, next) => {
  const warehouse = await warehouseService.getWarehouseById(getModels(req), req.params.id);
  res.status(200).json({ status: 'success', data: { warehouse } });
});

export const updateWarehouse = catchAsync(async (req, res, next) => {
  const warehouse = await warehouseService.updateWarehouse(getModels(req), req.params.id, req.body);
  res.status(200).json({ status: 'success', data: { warehouse } });
});

export const getWarehouseUsage = catchAsync(async (req, res, next) => {
  const usage = await warehouseService.getWarehouseUsage(getModels(req), req.params.id);
  res.status(200).json({ status: 'success', data: { usage } });
});

export const deleteWarehouse = catchAsync(async (req, res, next) => {
  const data = await warehouseService.deleteWarehouse(getModels(req), req.params.id, { moveToId: req.body?.move_to_id });
  res.status(200).json({ status: 'success', data });
});
