import express from "express";
import { protect, requirePermission } from "../../../middlewares/authMiddleware.js";
import { requireFeature } from "../../../middlewares/planMiddleware.js";
import { getCachedTenantConnection } from "../../../config/database.js";
import { initTenantModels } from "../../../models/index.js";
import catchAsync from "../../../utils/catchAsync.js";
import {
  approveHere,
  decideApprovalRequest,
  getApprovalDesk,
  listApprovers,
  recordCounterException,
  requestRemoteApproval,
} from "../approvalService.js";

const router = express.Router();

const getModels = (req) =>
  initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

router.use(protect, requireFeature("retail"));

router.get(
  "/approvers",
  catchAsync(async (req, res) => {
    const approvers = await listApprovers(getModels(req));
    res.status(200).json({ status: "success", data: { approvers } });
  }),
);

router.post(
  "/approve-here",
  catchAsync(async (req, res) => {
    const result = await approveHere(
      getModels(req),
      req.user.userId,
      req.body || {},
    );
    res.status(200).json({ status: "success", data: result });
  }),
);

router.post(
  "/request",
  catchAsync(async (req, res) => {
    const result = await requestRemoteApproval(
      getModels(req),
      req.user.userId,
      req.body || {},
      { tenantDbName: req.user.tenantDbName },
    );
    res.status(201).json({ status: "success", data: result });
  }),
);

router.post(
  "/:id/decide",
  requirePermission("approvals:decide"),
  catchAsync(async (req, res) => {
    const result = await decideApprovalRequest(
      getModels(req),
      req.params.id,
      req.user.userId,
      req.body || {},
      { tenantDbName: req.user.tenantDbName },
    );
    res.status(200).json({ status: "success", data: result });
  }),
);

router.post(
  "/record",
  requirePermission("retail:sell"),
  catchAsync(async (req, res) => {
    const result = await recordCounterException(
      getModels(req),
      req.user.userId,
      req.body || {},
    );
    res.status(201).json({ status: "success", data: result });
  }),
);

router.get(
  "/desk",
  requirePermission("approvals:decide"),
  catchAsync(async (req, res) => {
    const result = await getApprovalDesk(getModels(req), req.query || {});
    res.status(200).json({ status: "success", data: result });
  }),
);

export default router;
