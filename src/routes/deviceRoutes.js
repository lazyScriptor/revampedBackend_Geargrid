import express from "express";
import {
  ClaimPairingCodeContract,
  GetDeviceStatusContract,
  GetDevicePendingSignaturesContract,
} from "@geargrid/contracts";
import * as deviceService from "../services/deviceService.js";
import { registerContract } from "../utils/contractAdapter.js";
import { getMasterModels } from "../models/master/index.js";
import * as photos from "../controllers/equipmentPhotoController.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC endpoints — no auth. The device_id (or the short pairing code the
// operator typed) is sufficient to scope lookups:
//   • /pair — the code is looked up in geargrid_master.DEVICE_PAIRING_CODES
//     which already carries tenant_id + user_id (set when the POS minted).
//   • /:device_id/status — device_id is already paired, so the OperatorDevice
//     lookup iterates active tenants (cheap at current scale, cacheable).
// ─────────────────────────────────────────────────────────────────────────

registerContract(router, ClaimPairingCodeContract, {
  basePath: "/public/devices",
  handler: ({ body, req }) =>
    deviceService.claimPairingCode(getMasterModels(), {
      code: body.code,
      device_id: body.device_id,
      device_label: body.device_label,
      user_agent: req.headers["user-agent"] || null,
    }),
});

registerContract(router, GetDeviceStatusContract, {
  basePath: "/public/devices",
  handler: ({ params }) => deviceService.getDeviceStatus(getMasterModels(), params.device_id),
});

registerContract(router, GetDevicePendingSignaturesContract, {
  basePath: "/public/devices",
  handler: ({ params }) =>
    deviceService.getPendingSignaturesForDevice(getMasterModels(), params.device_id),
});

// Equipment photo requests for the paired phone (device_id + token authorise).
router.get("/:device_id/photo-requests", photos.devicePendingPhotos);
router.get("/:device_id/photo-requests/:token", photos.deviceGetPhotoRequest);
router.post("/:device_id/photo-requests/:token/photo", photos.receivePhoto, photos.deviceSubmitPhoto);

export default router;
