import express from "express";
import rateLimit from "express-rate-limit";
import {
  ClaimPairingCodeContract,
  GetPairingCodePreviewContract,
  GetDeviceStatusContract,
  GetDevicePendingSignaturesContract,
} from "@geargrid/contracts";
import * as deviceService from "../services/deviceService.js";
import { registerContract } from "../utils/contractAdapter.js";
import { getMasterModels } from "../models/master/index.js";
import * as photos from "../controllers/equipmentPhotoController.js";

const router = express.Router();

const pairLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: "fail", message: "Too many pairing attempts. Please try again in 15 minutes." },
});

const extractDeviceToken = (req) => {
  const headerToken = String(req.headers["x-device-token"] || "").trim();
  if (headerToken) return headerToken;
  const auth = String(req.headers.authorization || "");
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
};

const isNativePublicRequest = (req) => {
  const platform = String(req.headers["x-app-platform"] || "").toLowerCase();
  const ua = String(req.headers["user-agent"] || "");
  return platform === "android" || platform === "ios" || /Capacitor/i.test(ua);
};

const verifyPublicDeviceToken = async (req, _res, next) => {
  try {
    await deviceService.verifyDevicePublicAccess(
      getMasterModels(),
      req.params.device_id,
      extractDeviceToken(req),
      { isNativeClient: isNativePublicRequest(req) },
    );
    return next();
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC endpoints — device_id + pairing code / device token scope lookups.
// ─────────────────────────────────────────────────────────────────────────

registerContract(router, GetPairingCodePreviewContract, {
  basePath: "/public/devices",
  middlewares: [pairLimiter],
  handler: ({ params }) =>
    deviceService.getPairingCodePreview(getMasterModels(), { code: params.code }),
});

registerContract(router, ClaimPairingCodeContract, {
  basePath: "/public/devices",
  middlewares: [pairLimiter],
  handler: ({ body, req }) =>
    deviceService.claimPairingCode(getMasterModels(), {
      code: body.code,
      device_id: body.device_id,
      device_label: body.device_label,
      user_agent: req.headers["user-agent"] || null,
      device_model: body.device_model || null,
      os_version: body.os_version || null,
      app_version: body.app_version || null,
      consented_capabilities: body.consented_capabilities || null,
    }),
});

registerContract(router, GetDeviceStatusContract, {
  basePath: "/public/devices",
  handler: ({ params }) => deviceService.getDeviceStatus(getMasterModels(), params.device_id),
});

registerContract(router, GetDevicePendingSignaturesContract, {
  basePath: "/public/devices",
  middlewares: [verifyPublicDeviceToken],
  handler: ({ params }) =>
    deviceService.getPendingSignaturesForDevice(getMasterModels(), params.device_id),
});

// Equipment photo requests for the paired phone (device_id + token authorise).
router.get("/:device_id/photo-requests", verifyPublicDeviceToken, photos.devicePendingPhotos);
router.get("/:device_id/photo-requests/:token", verifyPublicDeviceToken, photos.deviceGetPhotoRequest);
router.post(
  "/:device_id/photo-requests/:token/photo",
  verifyPublicDeviceToken,
  photos.receivePhoto,
  photos.deviceSubmitPhoto,
);

export default router;
