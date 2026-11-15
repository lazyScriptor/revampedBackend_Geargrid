import express from "express";
import rateLimit from "express-rate-limit";
import {
  CreateLeadContactContract,
  SearchPhoneContactsContract,
  UsePhoneContactContract,
} from "@geargrid/contracts";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";
import { requireFeature } from "../middlewares/planMiddleware.js";
import { registerContract } from "../utils/contractAdapter.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import * as phoneContactService from "../services/phoneContactService.js";

const router = express.Router();

const resolveTenantModels = (req) =>
  req.tenantModels || initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

const useContactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId || req.user?.id || req.ip || "unknown"),
  validate: { keyGeneratorIpFallback: false },
  message: { status: "fail", message: "Too many contact requests. Please wait a few minutes." },
});

router.use(protect);
router.use(requireFeature("phone_assistant"));

registerContract(router, SearchPhoneContactsContract, {
  basePath: "/phone-contacts",
  middlewares: [requirePermission("phone_contacts:view")],
  handler: ({ query, req }) =>
    phoneContactService.searchPhoneContacts(resolveTenantModels(req), query, req.user),
});

registerContract(router, CreateLeadContactContract, {
  basePath: "/phone-contacts",
  middlewares: [requirePermission("calls:view")],
  handler: ({ body, req }) =>
    phoneContactService.createLeadContact(resolveTenantModels(req), body, { actorUser: req.user }),
});

registerContract(router, UsePhoneContactContract, {
  basePath: "/phone-contacts",
  middlewares: [requirePermission("phone_contacts:view"), useContactLimiter],
  handler: ({ params, body, req }) =>
    phoneContactService.usePhoneContact(resolveTenantModels(req), params.id, req.user, body),
});

export default router;
