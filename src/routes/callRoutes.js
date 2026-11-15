import express from "express";
import {
  DialCallContract,
  GetCallByIdContract,
  ListCallsContract,
  ListMissedCallsContract,
  MarkCallHandledContract,
  PostStaffCallNoteContract,
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

// Register static /calls/* routes before /calls/:id so they are never parsed as :id.
registerContract(router, DialCallContract, {
  basePath: "/calls",
  middlewares: [requirePermission("calls:view")],
  handler: ({ body, req }) =>
    callLogService.dialFromUserPhone(
      resolveTenantModels(req),
      req.user?.tenantDbName,
      req.user?.userId || req.user?.user_id || req.user?.id,
      body,
    ),
});

registerContract(router, ListMissedCallsContract, {
  basePath: "/calls",
  middlewares: [requirePermission("calls:view")],
  handler: ({ query, req }) => callLogService.listMissedCalls(resolveTenantModels(req), query),
});

registerContract(router, GetCallByIdContract, {
  basePath: "/calls",
  middlewares: [requirePermission("calls:view")],
  handler: ({ params, req }) => callLogService.getCallById(resolveTenantModels(req), params.id),
});

registerContract(router, ListCallsContract, {
  basePath: "/calls",
  middlewares: [requirePermission("calls:view")],
  handler: ({ query, req }) => callLogService.listCalls(resolveTenantModels(req), query),
});

registerContract(router, MarkCallHandledContract, {
  basePath: "/calls",
  middlewares: [requirePermission("calls:view")],
  handler: ({ params, req }) => callLogService.markCallHandled(resolveTenantModels(req), params.id),
});

registerContract(router, PostStaffCallNoteContract, {
  basePath: "/calls",
  middlewares: [requirePermission("calls:view")],
  handler: ({ params, body, req }) =>
    callLogService.saveStaffCallNote(
      resolveTenantModels(req),
      req.user?.userId || req.user?.user_id || req.user?.id,
      params.id,
      body,
    ),
});

export default router;
