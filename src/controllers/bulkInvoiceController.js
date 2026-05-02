import * as bulkInvoiceService from "../services/bulkInvoiceService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) =>
  initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

export const exportInvoices = catchAsync(async (req, res, next) => {
  const csvData = await bulkInvoiceService.exportInvoices(getModels(req));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=geargrid_invoices_export_${new Date().getTime()}.csv`,
  );
  res.status(200).send(csvData);
});
