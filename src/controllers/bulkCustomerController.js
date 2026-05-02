import * as bulkCustomerService from "../services/bulkCustomerService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) =>
  initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

export const downloadTemplate = catchAsync(async (req, res, next) => {
  const csvData = bulkCustomerService.generateTemplate();
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=geargrid_customers_template.csv",
  );
  res.status(200).send(csvData);
});

export const exportCustomers = catchAsync(async (req, res, next) => {
  const csvData = await bulkCustomerService.exportCustomers(getModels(req));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=geargrid_customers_export_${new Date().getTime()}.csv`,
  );
  res.status(200).send(csvData);
});

export const importCustomers = catchAsync(async (req, res, next) => {
  if (!req.file)
    return res
      .status(400)
      .json({ status: "error", message: "No CSV file uploaded." });
  const result = await bulkCustomerService.importCustomers(
    getModels(req),
    req.file.buffer,
  );
  res.status(200).json({ status: "success", data: result });
});
