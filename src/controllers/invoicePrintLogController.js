import catchAsync from "../utils/catchAsync.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import * as printLogService from "../services/invoicePrintLogService.js";

/**
 * Record a new print event.
 * POST /api/invoices/print-logs
 */
export const createPrintLog = catchAsync(async (req, res) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  const models = initTenantModels(connection);

  const ipAddress =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.ip ||
    null;

  const log = await printLogService.recordPrintLog(models, req.user, req.body, ipAddress);

  res.status(201).json({
    status: "success",
    message: "Print event logged successfully.",
    data: log,
  });
});

/**
 * List all print logs with filtering and pagination.
 * GET /api/invoices/print-logs
 * Protected by requirePermission("invoice:print_log:view")
 */
export const getPrintLogs = catchAsync(async (req, res) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  const models = initTenantModels(connection);

  const result = await printLogService.getPrintLogs(models, req.query);

  res.status(200).json({
    status: "success",
    data: result,
  });
});

/**
 * Get details and bill snapshot of a single print log.
 * GET /api/invoices/print-logs/:logId
 * Protected by requirePermission("invoice:print_log:view")
 */
export const getPrintLogDetails = catchAsync(async (req, res) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  const models = initTenantModels(connection);

  const log = await printLogService.getPrintLogById(models, req.params.logId);

  res.status(200).json({
    status: "success",
    data: log,
  });
});

/**
 * Get all print history specifically for an invoice.
 * GET /api/invoices/:id/print-logs
 * Protected by requirePermission("invoice:print_log:view")
 */
export const getInvoicePrintLogs = catchAsync(async (req, res) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  const models = initTenantModels(connection);

  const history = await printLogService.getInvoicePrintHistory(models, req.params.id);

  res.status(200).json({
    status: "success",
    data: history,
  });
});
