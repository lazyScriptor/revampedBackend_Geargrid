import express from "express";
import rateLimit from "express-rate-limit";
import {
  RegisterDeviceContract,
  RotateDeviceTokenContract,
  SyncDeviceContactsContract,
  GetDeviceBriefsContract,
  LookupDeviceBriefContract,
  PostDeviceCallContract,
  UnpairSelfDeviceContract,
  GetDeviceInvoiceContract,
  GetDevicePushPreferencesContract,
  UpdateDevicePushPreferencesContract,
  GetDevicePolicyContract,
  UpdateDeviceSettingsContract,
  DeleteDeviceContactsContract,
  DeleteDeviceCallsContract,
  PostDeviceCallNoteContract,
  ListDeviceMissedCallsContract,
  MarkDeviceCallHandledContract,
  ListDeviceFollowUpsContract,
  UpdateDeviceFollowUpContract,
  PostDeviceOpenCustomerContract,
  CreateDeviceLeadContactContract,
} from "@geargrid/contracts";
import { deviceAuth } from "../middlewares/deviceAuth.js";
import { requireFeature } from "../middlewares/planMiddleware.js";
import { registerContract } from "../utils/contractAdapter.js";
import { getMasterModels } from "../models/master/index.js";
import * as activityService from "../services/activityService.js";
import AppError from "../utils/AppError.js";
import { userHasPermission } from "../services/userService.js";
import { sendDataPush } from "../services/devicePushService.js";
import {
  getPhoneAssistantPolicy,
  loadUserCapabilitiesContext,
  resolveDeviceCapabilities,
} from "../services/phoneAssistantPolicyService.js";
import { getTenantPlan } from "../services/planService.js";
import * as deviceService from "../services/deviceService.js";
import * as phoneContactService from "../services/phoneContactService.js";
import * as pushEventService from "../services/pushEventService.js";
import * as invoiceService from "../services/invoiceService.js";
import * as customerBriefService from "../services/customerBriefService.js";
import * as callLogService from "../services/callLogService.js";

const router = express.Router();

const deviceRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.headers["x-device-id"] || req.ip || "unknown"),
  validate: { keyGeneratorIpFallback: false },
  message: { status: "fail", message: "Too many device requests. Please retry shortly." },
});

const requireDevicePermission = (permissionCode) => async (req, _res, next) => {
  try {
    const allowed = await userHasPermission(req.tenantModels, req.deviceUser, permissionCode);
    if (!allowed) {
      if (permissionCode === "calls:view" && req.device?.push_token) {
        sendDataPush(req.device, { type: "wipe_cache" }).catch(() => {});
      }
      return next(
        new AppError("Paired user does not have permission for this action.", 403, "forbidden"),
      );
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

const requireDeviceCapability = (capabilityKey) => async (req, _res, next) => {
  try {
    const [{ policy }, userCtx, plan] = await Promise.all([
      getPhoneAssistantPolicy(req.tenantModels),
      loadUserCapabilitiesContext(req.tenantModels, req.deviceUser || req.device?.user_id),
      getTenantPlan(req.tenantDbName),
    ]);
    const { effective, reasons } = resolveDeviceCapabilities({
      device: req.device,
      isAdmin: userCtx.isAdmin,
      permissionSet: userCtx.permissionSet,
      policy,
      planHasPhoneAssistant: plan?.features?.phone_assistant !== false,
      userActive: userCtx.user ? userCtx.user.is_active !== false : true,
    });
    if (!effective[capabilityKey]) {
      const reason = reasons[capabilityKey] || "capability_disabled";
      // For contact_sync & call_logging off by phone_switch, keep existing 409 behavior if contact_sync_enabled is false,
      // OR block with 403 for policy/grant/role/pending/suspended blocks.
      if (capabilityKey === "caller_brief" && req.device?.push_token) {
        sendDataPush(req.device, { type: "wipe_cache" }).catch(() => {});
      }
      if (reason === "phone_switch" && capabilityKey === "contact_sync") {
        return next(new AppError("Contact sync is disabled for this phone.", 409, reason));
      }
      if (reason === "phone_switch" && capabilityKey === "call_logging") {
        return next();
      }
      return next(
        new AppError(
          `Capability ${capabilityKey} is disabled for this phone.`,
          403,
          reason,
        ),
      );
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

router.use(deviceRateLimiter);
router.use(deviceAuth);

// A-06: Self-unpair works even when phone_assistant is disabled or suspended on the shop's plan.
registerContract(router, UnpairSelfDeviceContract, {
  basePath: "/device",
  handler: ({ req }) =>
    deviceService.unpairCurrentDevice(req.tenantModels, getMasterModels(), req.device),
});

// B.5: Rotate device token even if plan/status checks are transitioning.
registerContract(router, RotateDeviceTokenContract, {
  basePath: "/device",
  handler: ({ req }) => deviceService.rotateDeviceToken(req.tenantModels, req.device),
});

router.use(requireFeature("phone_assistant"));

registerContract(router, RegisterDeviceContract, {
  basePath: "/device",
  handler: ({ body, req }) =>
    deviceService.registerDevice(req.tenantModels, req.tenantDbName, req.device, body),
});

registerContract(router, GetDevicePolicyContract, {
  basePath: "/device",
  handler: ({ req }) =>
    deviceService.getDevicePolicy(req.tenantModels, req.tenantDbName, req.device),
});

registerContract(router, UpdateDeviceSettingsContract, {
  basePath: "/device",
  handler: ({ body, req }) =>
    deviceService.updateDeviceSettings(req.tenantModels, req.tenantDbName, req.device, body),
});

registerContract(router, SyncDeviceContactsContract, {
  basePath: "/device",
  middlewares: [requireDeviceCapability("contact_sync")],
  handler: ({ body, req }) =>
    phoneContactService.syncDeviceContacts(req.tenantModels, req.device, body),
});

registerContract(router, GetDevicePushPreferencesContract, {
  basePath: "/device",
  handler: ({ req }) =>
    pushEventService.getUserPushPreferences(req.tenantModels, req.device.user_id, req.device),
});

registerContract(router, UpdateDevicePushPreferencesContract, {
  basePath: "/device",
  handler: ({ body, req }) =>
    pushEventService.updateUserPushPreferences(
      req.tenantModels,
      req.device.user_id,
      body,
      req.device,
    ),
});

registerContract(router, GetDeviceInvoiceContract, {
  basePath: "/device",
  middlewares: [requireDeviceCapability("bill_view")],
  handler: ({ params, req }) =>
    invoiceService.getDeviceInvoiceSummary(req.tenantModels, req.device, params.id),
});

registerContract(router, GetDeviceBriefsContract, {
  basePath: "/device",
  middlewares: [requireDevicePermission("calls:view"), requireDeviceCapability("caller_brief")],
  handler: ({ query, req }) =>
    customerBriefService.syncDeviceBriefs(req.tenantModels, req.device, query),
});

registerContract(router, LookupDeviceBriefContract, {
  basePath: "/device",
  middlewares: [requireDevicePermission("calls:view"), requireDeviceCapability("caller_brief")],
  handler: ({ query, req }) =>
    customerBriefService.lookupDeviceBrief(req.tenantModels, req.device, query),
});

registerContract(router, PostDeviceCallContract, {
  basePath: "/device",
  middlewares: [requireDeviceCapability("call_logging")],
  handler: ({ body, req }) =>
    callLogService.recordDeviceCall(req.tenantModels, req.tenantDbName, req.device, body),
});

registerContract(router, DeleteDeviceContactsContract, {
  basePath: "/device",
  handler: ({ req }) =>
    phoneContactService.deleteDeviceContacts(req.tenantModels, req.device),
});

registerContract(router, DeleteDeviceCallsContract, {
  basePath: "/device",
  handler: ({ req }) => callLogService.deleteDeviceCalls(req.tenantModels, req.device),
});

registerContract(router, PostDeviceCallNoteContract, {
  basePath: "/device",
  middlewares: [requireDeviceCapability("call_logging")],
  handler: ({ params, body, req }) =>
    callLogService.saveDeviceCallNote(
      req.tenantModels,
      req.device,
      params.client_call_id,
      body,
    ),
});

registerContract(router, ListDeviceMissedCallsContract, {
  basePath: "/device",
  middlewares: [requireDevicePermission("calls:view")],
  handler: ({ query, req }) => callLogService.listMissedCalls(req.tenantModels, query),
});

registerContract(router, MarkDeviceCallHandledContract, {
  basePath: "/device",
  middlewares: [requireDevicePermission("calls:view")],
  handler: ({ params, req }) => callLogService.markCallHandled(req.tenantModels, params.id),
});

registerContract(router, ListDeviceFollowUpsContract, {
  basePath: "/device",
  middlewares: [requireDevicePermission("calls:view")],
  handler: ({ query, req }) => callLogService.listFollowUps(req.tenantModels, query),
});

registerContract(router, UpdateDeviceFollowUpContract, {
  basePath: "/device",
  middlewares: [requireDevicePermission("calls:view")],
  handler: ({ params, body, req }) =>
    callLogService.updateFollowUp(req.tenantModels, params.id, body),
});

registerContract(router, PostDeviceOpenCustomerContract, {
  basePath: "/device",
  middlewares: [requireDevicePermission("calls:view")],
  handler: ({ body, req }) =>
    deviceService.openCustomerOnDesktop(req.tenantModels, req.tenantDbName, req.device, body),
});

registerContract(router, CreateDeviceLeadContactContract, {
  basePath: "/device",
  middlewares: [requireDevicePermission("calls:view")],
  handler: ({ body, req }) =>
    phoneContactService.createLeadContact(req.tenantModels, body, { device: req.device }),
});

// Activity feed endpoints for paired mobile app (Slice 1 / M3)
router.get("/activity/summary", requireDevicePermission("activity:view"), async (req, res, next) => {
  try {
    const canCheck = Boolean(req.devicePermissions?.has?.("*") || req.devicePermissions?.has?.("activity:check"));
    const data = await activityService.getActivitySummary(req.tenantModels, req.query, {
      userId: req.device.user_id,
      canCheck,
    });
    res.status(200).json({ status: "success", data });
  } catch (err) {
    next(err);
  }
});

router.get("/activity", requireDevicePermission("activity:view"), async (req, res, next) => {
  try {
    const data = await activityService.listActivity(req.tenantModels, req.query, {
      userId: req.device.user_id,
    });
    res.status(200).json({ status: "success", data });
  } catch (err) {
    next(err);
  }
});

router.post("/activity/read", requireDevicePermission("activity:view"), async (req, res, next) => {
  try {
    const data = await activityService.markRead(
      req.tenantModels,
      req.body?.event_ids || req.body?.ids || [],
      req.device.user_id,
    );
    res.status(200).json({ status: "success", data });
  } catch (err) {
    next(err);
  }
});

router.post("/activity/:id/check", requireDevicePermission("activity:check"), async (req, res, next) => {
  try {
    const event = await activityService.checkEvent(req.tenantModels, Number(req.params.id), req.device.user_id);
    res.status(200).json({
      status: "success",
      data: { event_id: event.event_id, checked_by: event.checked_by, checked_at: event.checked_at },
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/activity/:id/check", requireDevicePermission("activity:check"), async (req, res, next) => {
  try {
    const event = await activityService.uncheckEvent(req.tenantModels, Number(req.params.id));
    res.status(200).json({
      status: "success",
      data: { event_id: event.event_id, checked_by: null, checked_at: null },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/activity/:id/comments", requireDevicePermission("activity:view"), async (req, res, next) => {
  try {
    const comments = await activityService.listComments(req.tenantModels, Number(req.params.id));
    res.status(200).json({ status: "success", data: { comments } });
  } catch (err) {
    next(err);
  }
});

router.post("/activity/:id/comments", requireDevicePermission("activity:view"), async (req, res, next) => {
  try {
    const comment = await activityService.addComment(
      req.tenantModels,
      Number(req.params.id),
      req.device.user_id,
      req.body?.body,
    );
    res.status(201).json({ status: "success", data: { comment } });
  } catch (err) {
    next(err);
  }
});

export default router;
