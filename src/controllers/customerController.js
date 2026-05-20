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

export const deleteCustomer = catchAsync(async (req, res, next) => {
  await customerService.deleteCustomer(getModels(req), req.params.id);
  res.status(200).json({ status: 'success', message: 'Customer archived.' });
});

// Lightweight list of customers that can act as a parent, used by the
// customer form dropdown. Accepts:
//   ?exclude=<id>  — hide the customer currently being edited
//   ?search=<q>    — fuzzy match across name / company / phone / NIC
export const getParentCustomerOptions = catchAsync(async (req, res, next) => {
  const excludeId = req.query.exclude ? parseInt(req.query.exclude, 10) : null;
  const search = typeof req.query.search === "string" ? req.query.search : "";
  const options = await customerService.getParentOptions(getModels(req), {
    excludeId,
    search,
  });
  res.status(200).json({ status: 'success', data: { options } });
});