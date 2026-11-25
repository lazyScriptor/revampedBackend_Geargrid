import express from "express";
import * as tenantConfigController from "../controllers/tenantConfigController.js";
import {
  getConfig,
  updateConfig,
  getBillDetails,
  updateBillDetails,
} from "../controllers/tenantConfigController.js";
import * as signatureService from "../services/signatureService.js";
import * as collectionsSettingsService from "../services/collectionsSettingsService.js";
import catchAsync from "../utils/catchAsync.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";
import { registerContract } from "../utils/contractAdapter.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import {
  GetRentalTermsContract,
  UpdateRentalTermsContract,
} from "@geargrid/contracts";

const router = express.Router();
router.use(protect);

const resolveTenantModels = (req) =>
  initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

// GET /api/config
// PUT /api/config
router.route("/")
  .get(requirePermission("config:view"), getConfig)
  .put(requirePermission("config:manage"), updateConfig);

// GET /api/config/bill — shop phone / address / email printed on receipts
// PUT /api/config/bill — merges only those fields into custom_settings
router.route("/bill")
  .get(requirePermission("config:view"), getBillDetails)
  .put(requirePermission("config:manage"), updateBillDetails);

// Rental terms — surface read-access to any staff, write-access to config managers.
registerContract(router, GetRentalTermsContract, {
  basePath: "/config",
  middlewares: [requirePermission("config:view")],
  handler: ({ req }) => signatureService.getRentalTerms(resolveTenantModels(req)),
});

registerContract(router, UpdateRentalTermsContract, {
  basePath: "/config",
  middlewares: [requirePermission("config:manage")],
  handler: ({ body, req }) =>
    signatureService.updateRentalTerms(resolveTenantModels(req), body.markdown),
});

router
  .route("/collections")
  .get(
    requirePermission("config:view"),
    catchAsync(async (req, res) => {
      const settings = await collectionsSettingsService.getCollectionsSettings(
        resolveTenantModels(req),
      );
      res.status(200).json({ status: "success", data: settings });
    }),
  )
  .put(
    requirePermission("config:manage"),
    catchAsync(async (req, res) => {
      const settings = await collectionsSettingsService.updateCollectionsSettings(
        resolveTenantModels(req),
        req.body,
      );
      res.status(200).json({ status: "success", data: settings });
    }),
  );

export default router;
