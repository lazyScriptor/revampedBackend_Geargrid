import express from "express";
import { SearchPhoneContactsContract, UsePhoneContactContract } from "@geargrid/contracts";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";
import { requireFeature } from "../middlewares/planMiddleware.js";
import { registerContract } from "../utils/contractAdapter.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import * as phoneContactService from "../services/phoneContactService.js";

const router = express.Router();

const resolveTenantModels = (req) =>
  initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

router.use(protect);
router.use(requireFeature("phone_assistant"));

registerContract(router, SearchPhoneContactsContract, {
  basePath: "/phone-contacts",
  middlewares: [requirePermission("phone_contacts:view")],
  handler: ({ query, req }) =>
    phoneContactService.searchPhoneContacts(resolveTenantModels(req), query),
});

registerContract(router, UsePhoneContactContract, {
  basePath: "/phone-contacts",
  middlewares: [requirePermission("phone_contacts:view")],
  handler: ({ params, req }) =>
    phoneContactService.usePhoneContact(resolveTenantModels(req), params.id, req.user),
});

export default router;
