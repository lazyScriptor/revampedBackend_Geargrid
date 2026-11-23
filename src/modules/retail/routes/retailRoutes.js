import express from "express";
import { protect, requirePermission } from "../../../middlewares/authMiddleware.js";
import { requireFeature } from "../../../middlewares/planMiddleware.js";
import { getCachedTenantConnection } from "../../../config/database.js";
import { initTenantModels } from "../../../models/index.js";
import catchAsync from "../../../utils/catchAsync.js";
import { ensureWalkInCustomer } from "../walkInService.js";
import { getRetailSettings, updateRetailSettings } from "../retailSettingsService.js";

const router = express.Router();

const getModels = (req) =>
  initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

router.use(protect, requireFeature("retail"));

router
  .route("/settings")
  .get(
    requirePermission("retail:view"),
    catchAsync(async (req, res) => {
      const settings = await getRetailSettings(getModels(req));
      res.status(200).json({ status: "success", data: { settings } });
    }),
  )
  .put(
    requirePermission("config:manage"),
    catchAsync(async (req, res) => {
      const settings = await updateRetailSettings(getModels(req), req.body);
      res.status(200).json({ status: "success", data: { settings } });
    }),
  );

router.get(
  "/walk-in",
  requirePermission("retail:sell"),
  catchAsync(async (req, res) => {
    const customer = await ensureWalkInCustomer(getModels(req));
    res.status(200).json({ status: "success", data: { customer } });
  }),
);

export default router;
