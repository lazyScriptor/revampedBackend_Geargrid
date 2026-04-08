import * as customerService from '../services/customerService.js';
import { getCachedTenantConnection } from '../config/database.js';
import { initTenantModels } from '../models/index.js';
import catchAsync from '../utils/catchAsync.js';

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

export const createCustomer = catchAsync(async (req, res, next) => {
  const newCustomer = await customerService.createCustomer(getModels(req), req.body);
  res.status(201).json({ status: 'success', data: { customer: newCustomer } });
});

export const getCustomers = catchAsync(async (req, res, next) => {
  const result = await customerService.getAllCustomers(getModels(req), req.query);
  res.status(200).json({ status: 'success', data: result });
});

export const getSingleCustomer = catchAsync(async (req, res, next) => {
  const customer = await customerService.getCustomerById(getModels(req), req.params.id);
  res.status(200).json({ status: 'success', data: { customer } });
});

export const updateCustomer = catchAsync(async (req, res, next) => {
  const updatedCustomer = await customerService.updateCustomer(getModels(req), req.params.id, req.body);
  res.status(200).json({ status: 'success', data: { customer: updatedCustomer } });
});