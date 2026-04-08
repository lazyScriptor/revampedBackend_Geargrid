import * as categoryService from '../services/categoryService.js';
import { getCachedTenantConnection } from '../config/database.js';
import { initTenantModels } from '../models/index.js';
import catchAsync from '../utils/catchAsync.js';

const getModels = (req) => initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

export const createCategory = catchAsync(async (req, res, next) => {
  const category = await categoryService.createCategory(getModels(req), req.body);
  res.status(201).json({ status: 'success', data: { category } });
});

export const getCategories = catchAsync(async (req, res, next) => {
  const result = await categoryService.getAllCategories(getModels(req), req.query);
  res.status(200).json({ status: 'success', data: result });
});

export const getSingleCategory = catchAsync(async (req, res, next) => {
  const category = await categoryService.getCategoryById(getModels(req), req.params.id);
  res.status(200).json({ status: 'success', data: { category } });
});

export const updateCategory = catchAsync(async (req, res, next) => {
  const category = await categoryService.updateCategory(getModels(req), req.params.id, req.body);
  res.status(200).json({ status: 'success', data: { category } });
});