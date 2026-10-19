import express from "express";
import multer from "multer";
import * as meController from "../controllers/meController.js";
import * as signatureService from "../services/signatureService.js";
import * as deviceService from "../services/deviceService.js";
import { protect } from "../middlewares/authMiddleware.js";
import { registerContract } from "../utils/contractAdapter.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import {
  SetOperatorSignatureContract,
  DeleteOperatorSignatureContract,
  MintPairingCodeContract,
  ListMyDevicesContract,
  UnpairDeviceContract,
} from "@geargrid/contracts";
import { getMasterModels } from "../models/master/index.js";

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
router.patch("/", meController.updateProfile);
router.patch("/preferences", meController.updatePreferences);
router.post("/change-password", meController.changePassword);
router.post("/avatar", upload.single("avatar"), meController.uploadAvatar);
router.delete("/avatar", meController.deleteAvatar);
router.get("/activity", meController.getActivity);
router.get("/recent-work", meController.getRecentWork);

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
  handler: async ({ req }) => {
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
    });
  },
});

registerContract(router, ListMyDevicesContract, {
  basePath: "/me",
  handler: ({ req }) =>
    deviceService.listMyDevices(
      resolveTenantModels(req),
      req.user?.id || req.user?.userId,
    ),
});

registerContract(router, UnpairDeviceContract, {
  basePath: "/me",
  handler: ({ params, req }) =>
    deviceService.unpairDevice(
      resolveTenantModels(req),
      params.operator_device_id,
      req.user?.id || req.user?.userId,
    ),
});

export default router;
