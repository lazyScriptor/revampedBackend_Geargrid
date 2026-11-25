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
import * as callRecordingService from "../services/callRecordingService.js";
import catchAsync from "../utils/catchAsync.js";

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

router.post(
  "/manual",
  requirePermission("calls:view"),
  catchAsync(async (req, res) => {
    const userId = req.user?.userId || req.user?.user_id || req.user?.id;
    const data = await callLogService.createManualCall(
      resolveTenantModels(req),
      userId,
      req.body,
    );
    res.status(201).json({ status: "success", data });
  }),
);

router.post(
  "/:id/link-customer",
  requirePermission("calls:view"),
  catchAsync(async (req, res) => {
    const data = await callLogService.linkCallToCustomer(
      resolveTenantModels(req),
      req.params.id,
      req.body,
    );
    res.status(200).json({ status: "success", data });
  }),
);

router.get(
  "/:id/recording",
  requirePermission("calls:listen"),
  catchAsync(async (req, res) => {
    const userId = req.user?.userId || req.user?.user_id || req.user?.id;
    const playback = await callRecordingService.getCallRecordingPlayback(
      resolveTenantModels(req),
      userId,
      req.params.id,
    );
    if (playback.mode === "signed_url") {
      return res.status(200).json({ status: "success", data: playback });
    }
    res.setHeader("Content-Type", playback.mime_type || "audio/mpeg");
    if (playback.bytes) {
      res.setHeader("Content-Length", String(playback.bytes));
    }
    res.setHeader("Accept-Ranges", "bytes");
    return playback.stream.pipe(res);
  }),
);

router.patch(
  "/:id/dispute-hold",
  requirePermission("calls:listen"),
  catchAsync(async (req, res) => {
    const data = await callRecordingService.setCallRecordingDisputeHold(
      resolveTenantModels(req),
      req.params.id,
      req.body,
    );
    res.status(200).json({ status: "success", data });
  }),
);

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

// The shared contract lists only tags, note and follow_up_on and strips the rest, so the call card's
// outcome, result, promise and bills pass through here. callLogService validates each of them.
const StaffCallNoteContract = {
  ...PostStaffCallNoteContract,
  body: PostStaffCallNoteContract.body.passthrough(),
};

registerContract(router, StaffCallNoteContract, {
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
