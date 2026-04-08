import * as defectLogService from "../services/defectLogService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) =>
  initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

export const createLog = catchAsync(async (req, res, next) => {
  const log = await defectLogService.createDefectLog(getModels(req), req.body);
  res.status(201).json({ status: "success", data: { log } });
});

export const getLogs = catchAsync(async (req, res, next) => {
  const result = await defectLogService.getAllDefectLogs(
    getModels(req),
    req.query,
  );
  res.status(200).json({ status: "success", data: result });
});

export const markResolved = catchAsync(async (req, res, next) => {
  const log = await defectLogService.resolveDefectLog(
    getModels(req),
    req.params.id,
  );
  res.status(200).json({ status: "success", data: { log } });
});
