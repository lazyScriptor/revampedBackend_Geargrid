import * as accountingService from "../services/accountingService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";
import { resolveTenantTz } from "../utils/dateRange.js";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

// Attach the tenant's IANA timezone to the query so the service can convert
// YYYY-MM-DD bounds into local-day instants.
const withTenantTz = (req) => ({ ...req.query, tenantTz: resolveTenantTz(req) });

// GET /accounting/invoices
export const getInvoices = catchAsync(async (req, res) => {
  const result = await accountingService.getFilteredInvoices(getModels(req), withTenantTz(req));
  res.status(200).json({ status: "success", data: result });
});

// GET /accounting/payments
export const getPayments = catchAsync(async (req, res) => {
  const result = await accountingService.getFilteredPayments(getModels(req), withTenantTz(req));
  res.status(200).json({ status: "success", data: result });
});

// GET /accounting/expenses
export const getExpenses = catchAsync(async (req, res) => {
  const result = await accountingService.getFilteredExpenses(getModels(req), withTenantTz(req));
  res.status(200).json({ status: "success", data: result });
});

// GET /accounting/journal
export const getJournal = catchAsync(async (req, res) => {
  const result = await accountingService.getTransactionJournal(getModels(req), withTenantTz(req));
  res.status(200).json({ status: "success", data: result });
});

export const getCharts = catchAsync(async (req, res) => {
  const result = await accountingService.getChartData(getModels(req), withTenantTz(req));
  res.status(200).json({ status: "success", data: result });
});
