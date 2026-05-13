import * as accountingService from "../services/accountingService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

// GET /accounting/invoices
export const getInvoices = catchAsync(async (req, res) => {
  const result = await accountingService.getFilteredInvoices(getModels(req), req.query);
  res.status(200).json({ status: "success", data: result });
});

// GET /accounting/payments
export const getPayments = catchAsync(async (req, res) => {
  const result = await accountingService.getFilteredPayments(getModels(req), req.query);
  res.status(200).json({ status: "success", data: result });
});

// GET /accounting/expenses
export const getExpenses = catchAsync(async (req, res) => {
  const result = await accountingService.getFilteredExpenses(getModels(req), req.query);
  res.status(200).json({ status: "success", data: result });
});

// GET /accounting/journal
export const getJournal = catchAsync(async (req, res) => {
  const result = await accountingService.getTransactionJournal(getModels(req), req.query);
  res.status(200).json({ status: "success", data: result });
});

export const getCharts = catchAsync(async (req, res) => {
  const result = await accountingService.getChartData(getModels(req), req.query);
  res.status(200).json({ status: "success", data: result });
});
