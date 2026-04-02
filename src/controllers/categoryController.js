import * as categoryService from '../services/categoryService.js';
import { getCachedTenantConnection } from '../config/database.js';
import { initTenantModels } from '../models/index.js';
import catchAsync from '../utils/catchAsync.js';

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

export const createCategory = catchAsync(async (req, res, next) => {
  const { categoryName, description } = req.body;
  
  const category = await categoryService.createCategory(getModels(req), categoryName, description);
  res.status(201).json({ status: 'success', data: { category } });
});

export const getCategories = catchAsync(async (req, res, next) => {
  const categories = await categoryService.getAllCategories(getModels(req));
  res.status(200).json({ status: 'success', data: { categories } });
});