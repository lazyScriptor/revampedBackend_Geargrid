import * as tenantConfigService from "../services/tenantConfigService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) =>
  initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

export const getConfig = catchAsync(async (req, res, next) => {
  const config = await tenantConfigService.getTenantConfig(getModels(req));
  res.status(200).json({ status: "success", data: { config } });
});

export const updateConfig = catchAsync(async (req, res, next) => {
  const config = await tenantConfigService.updateTenantConfig(
    getModels(req),
    req.body,
  );
  res.status(200).json({ status: "success", data: { config } });
});
