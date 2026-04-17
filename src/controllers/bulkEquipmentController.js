import * as bulkEquipmentService from "../services/bulkEquipmentService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

export const downloadTemplate = catchAsync(async (req, res, next) => {
  const csvData = bulkEquipmentService.generateTemplate();

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=geargrid_equipment_template.csv",
  );
  res.status(200).send(csvData);
});

export const exportEquipment = catchAsync(async (req, res, next) => {
  const csvData = await bulkEquipmentService.exportEquipment(getModels(req));

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=geargrid_export_${new Date().getTime()}.csv`,
  );
  res.status(200).send(csvData);
});

export const importEquipment = catchAsync(async (req, res, next) => {
  // Ensure Multer successfully attached the file to the request
  if (!req.file) {
    return res
      .status(400)
      .json({ status: "error", message: "No CSV file uploaded." });
  }

  // req.file.buffer contains the file data in memory
  const result = await bulkEquipmentService.importEquipment(
    getModels(req),
    req.file.buffer,
  );

  res.status(200).json({
    status: "success",
    data: result, // Contains successCount and the errors array
  });
});
