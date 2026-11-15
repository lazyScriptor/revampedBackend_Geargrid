import express from "express";
import {
  ListFollowUpsContract,
  UpdateFollowUpContract,
} from "@geargrid/contracts";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";
import { requireFeature } from "../middlewares/planMiddleware.js";
import { registerContract } from "../utils/contractAdapter.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import * as callLogService from "../services/callLogService.js";

const router = express.Router();

const resolveTenantModels = (req) =>
  req.tenantModels || initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

router.use(protect);
router.use(requireFeature("phone_assistant"));

registerContract(router, ListFollowUpsContract, {
  basePath: "/follow-ups",
  middlewares: [requirePermission("calls:view")],
  handler: ({ query, req }) => callLogService.listFollowUps(resolveTenantModels(req), query),
});

registerContract(router, UpdateFollowUpContract, {
  basePath: "/follow-ups",
  middlewares: [requirePermission("calls:view")],
  handler: ({ params, body, req }) =>
    callLogService.updateFollowUp(resolveTenantModels(req), params.id, body),
});

export default router;
