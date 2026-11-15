import express from "express";
import {
  GetCallByIdContract,
  ListCallsContract,
} from "@geargrid/contracts";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";
import { requireFeature } from "../middlewares/planMiddleware.js";
import { registerContract } from "../utils/contractAdapter.js";
import * as callLogService from "../services/callLogService.js";

const router = express.Router();

router.use(protect);
router.use(requireFeature("phone_assistant"));

registerContract(router, GetCallByIdContract, {
  basePath: "/calls",
  middlewares: [requirePermission("calls:view")],
  handler: ({ params, req }) => callLogService.getCallById(req.tenantModels, params.id),
});

registerContract(router, ListCallsContract, {
  basePath: "/calls",
  middlewares: [requirePermission("calls:view")],
  handler: ({ query, req }) => callLogService.listCalls(req.tenantModels, query),
});

export default router;
