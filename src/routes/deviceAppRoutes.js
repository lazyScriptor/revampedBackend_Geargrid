import express from "express";
import {
  RegisterDeviceContract,
  SyncDeviceContactsContract,
  GetDeviceBriefsContract,
  LookupDeviceBriefContract,
  PostDeviceCallContract,
  GetDeviceInvoiceContract,
  GetDevicePushPreferencesContract,
  UpdateDevicePushPreferencesContract,
} from "@geargrid/contracts";
import { deviceAuth } from "../middlewares/deviceAuth.js";
import { requireFeature } from "../middlewares/planMiddleware.js";
import { registerContract } from "../utils/contractAdapter.js";
import * as deviceService from "../services/deviceService.js";
import * as phoneContactService from "../services/phoneContactService.js";
import * as pushEventService from "../services/pushEventService.js";
import * as invoiceService from "../services/invoiceService.js";
import * as customerBriefService from "../services/customerBriefService.js";
import * as callLogService from "../services/callLogService.js";

const router = express.Router();

router.use(deviceAuth);
router.use(requireFeature("phone_assistant"));

registerContract(router, RegisterDeviceContract, {
  basePath: "/device",
  handler: ({ body, req }) =>
    deviceService.registerDevice(req.tenantModels, req.tenantDbName, req.device, body),
});

registerContract(router, SyncDeviceContactsContract, {
  basePath: "/device",
  handler: ({ body, req }) =>
    phoneContactService.syncDeviceContacts(req.tenantModels, req.device, body),
});

registerContract(router, GetDevicePushPreferencesContract, {
  basePath: "/device",
  handler: ({ req }) =>
    pushEventService.getUserPushPreferences(req.tenantModels, req.device.user_id),
});

registerContract(router, UpdateDevicePushPreferencesContract, {
  basePath: "/device",
  handler: ({ body, req }) =>
    pushEventService.updateUserPushPreferences(req.tenantModels, req.device.user_id, body),
});

registerContract(router, GetDeviceInvoiceContract, {
  basePath: "/device",
  handler: ({ params, req }) =>
    invoiceService.getDeviceInvoiceSummary(req.tenantModels, req.device, params.id),
});

registerContract(router, GetDeviceBriefsContract, {
  basePath: "/device",
  handler: ({ query, req }) =>
    customerBriefService.syncDeviceBriefs(req.tenantModels, req.device, query),
});

registerContract(router, LookupDeviceBriefContract, {
  basePath: "/device",
  handler: ({ query, req }) =>
    customerBriefService.lookupDeviceBrief(req.tenantModels, req.device, query),
});

registerContract(router, PostDeviceCallContract, {
  basePath: "/device",
  handler: ({ body, req }) =>
    callLogService.recordDeviceCall(req.tenantModels, req.tenantDbName, req.device, body),
});

export default router;
