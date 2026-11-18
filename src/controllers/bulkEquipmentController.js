import * as bulkEquipmentService from "../services/bulkEquipmentService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

export const downloadTemplate = catchAsync(async (req, res) => {
  if (String(req.query.format || "").toLowerCase() === "xlsx") {
    const buf = await bulkEquipmentService.generateExcelTemplate(getModels(req));
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=geargrid_equipment_template.xlsx",
    );
    return res.status(200).send(buf);
  }

  const csvData = bulkEquipmentService.generateTemplate();
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=geargrid_equipment_template.csv",
  );
  res.status(200).send(csvData);
});

export const exportEquipment = catchAsync(async (req, res) => {
  const csvData = await bulkEquipmentService.exportEquipment(getModels(req));

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=geargrid_export_${new Date().getTime()}.csv`,
  );
  res.status(200).send(csvData);
});
