import express from "express";
import multer from "multer";
import * as meController from "../controllers/meController.js";
import * as signatureService from "../services/signatureService.js";
import * as deviceService from "../services/deviceService.js";
import * as pushEventService from "../services/pushEventService.js";
import { protect } from "../middlewares/authMiddleware.js";
import { requireFeature } from "../middlewares/planMiddleware.js";
import { registerContract } from "../utils/contractAdapter.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import {
  SetOperatorSignatureContract,
  DeleteOperatorSignatureContract,
  MintPairingCodeContract,
  ListMyDevicesContract,
  UnpairDeviceContract,
  GetMyPushPreferencesContract,
  UpdateMyPushPreferencesContract,
} from "@geargrid/contracts";
import { getMasterModels } from "../models/master/index.js";
import catchAsync from "../utils/catchAsync.js";
import { setMyApprovalPin } from "../modules/retail/index.js";

const router = express.Router();

const resolveTenantModels = (req) =>
  initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

// 5 MB cap for avatar uploads — image-only is enforced in the service.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(protect);

router.get("/", meController.getProfile);
router.get("/plan", meController.getPlan);
router.patch("/", meController.updateProfile);
router.patch("/preferences", meController.updatePreferences);
router.post("/change-password", meController.changePassword);
router.post("/avatar", upload.single("avatar"), meController.uploadAvatar);
router.delete("/avatar", meController.deleteAvatar);
router.get("/activity", meController.getActivity);
router.get("/recent-work", meController.getRecentWork);
router.get("/ui-preferences", meController.getUiPreferences);
router.put("/ui-preferences/:key", meController.putUiPreference);
router.put(
  "/approval-pin",
  catchAsync(async (req, res) => {
    const data = await setMyApprovalPin(
      resolveTenantModels(req),
      req.user.userId,
      req.body || {},
    );
    res.status(200).json({ status: "success", data });
  }),
);

// Operator reusable signature — governed by @geargrid/contracts.
registerContract(router, SetOperatorSignatureContract, {
  basePath: "/me",
  handler: ({ body, req }) =>
    signatureService.setOperatorSignature(
      resolveTenantModels(req),
      req.user?.id || req.user?.userId,
      body,
      { tenantDbName: req.user.tenantDbName },
    ),
});

registerContract(router, DeleteOperatorSignatureContract, {
  basePath: "/me",
  handler: ({ req }) =>
    signatureService.deleteOperatorSignature(
      resolveTenantModels(req),
      req.user?.id || req.user?.userId,
    ),
});

// Paired-PWA device management for the authenticated operator.
// MintPairingCode writes to master DB (needs tenant_id); list/unpair stay
// in the current tenant's OPERATOR_DEVICES.
registerContract(router, MintPairingCodeContract, {
  basePath: "/me",
  handler: async ({ body, req }) => {
    const masterModels = getMasterModels();
    // JWT carries tenantDbName; resolve to tenant_id for the master row.
    const tenant = await masterModels.Tenant.findOne({
      where: { db_name: req.user.tenantDbName },
      attributes: ["tenant_id"],
    });
    if (!tenant) {
      const AppError = (await import("../utils/AppError.js")).default;
      throw new AppError("Tenant not found.", 404);
    }
    return deviceService.mintPairingCode(masterModels, {
      tenant_id: tenant.tenant_id,
      user_id: req.user?.id || req.user?.userId,
      requested_capabilities: body?.requested_capabilities || null,
    });
  },
});

registerContract(router, ListMyDevicesContract, {
  basePath: "/me",
  handler: ({ req }) =>
    deviceService.listMyDevices(
      resolveTenantModels(req),
      req.user?.id || req.user?.userId,
      req.user.tenantDbName,
    ),
});

registerContract(router, UnpairDeviceContract, {
  basePath: "/me",
  handler: ({ params, req }) =>
    deviceService.unpairDevice(
      resolveTenantModels(req),
      params.operator_device_id,
      req.user?.id || req.user?.userId,
      getMasterModels(),
    ),
});

registerContract(router, GetMyPushPreferencesContract, {
  basePath: "/me",
  middlewares: [requireFeature("phone_assistant")],
  handler: ({ req }) =>
    pushEventService.getUserPushPreferences(
      resolveTenantModels(req),
      req.user?.userId || req.user?.id,
    ),
});

registerContract(router, UpdateMyPushPreferencesContract, {
  basePath: "/me",
  middlewares: [requireFeature("phone_assistant")],
  handler: ({ body, req }) =>
    pushEventService.updateUserPushPreferences(
      resolveTenantModels(req),
      req.user?.userId || req.user?.id,
      body,
    ),
});

export default router;
