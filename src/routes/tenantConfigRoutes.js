import express from "express";
import {
  getConfig,
  updateConfig,
} from "../controllers/tenantConfigController.js";
import * as signatureService from "../services/signatureService.js";
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

export default router;
