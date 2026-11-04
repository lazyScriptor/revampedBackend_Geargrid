import * as meService from "../services/meService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";
import { countUsage, getTenantPlan } from "../services/planService.js";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

export const getProfile = catchAsync(async (req, res) => {
  const profile = await meService.getMyProfile(getModels(req), req.user.userId);
  res.status(200).json({ status: "success", data: { profile } });
});

// What this shop's plan includes. Null plan: it couldn't be read, and the app then hides nothing.
export const getPlan = catchAsync(async (req, res) => {
  const plan = await getTenantPlan(req.user.tenantDbName);
  const usage = plan ? await countUsage(getModels(req)) : null;
  res.status(200).json({ status: "success", data: { plan, usage } });
});

export const updateProfile = catchAsync(async (req, res) => {
  const profile = await meService.updateMyProfile(
    getModels(req),
    req.user.userId,
    req.body || {},
  );
  res.status(200).json({ status: "success", data: { profile } });
});

export const updatePreferences = catchAsync(async (req, res) => {
  const profile = await meService.updateMyPreferences(
    getModels(req),
    req.user.userId,
    req.body || {},
  );
  res.status(200).json({ status: "success", data: { profile } });
});

export const changePassword = catchAsync(async (req, res) => {
  const result = await meService.changeMyPassword(
    getModels(req),
    req.user.userId,
    req.body || {},
  );
  res.status(200).json({ status: "success", data: result });
});

export const uploadAvatar = catchAsync(async (req, res) => {
  const profile = await meService.setMyAvatar(
    getModels(req),
    req.user.userId,
    req.file,
  );
  res.status(200).json({ status: "success", data: { profile } });
});

export const deleteAvatar = catchAsync(async (req, res) => {
  const profile = await meService.removeMyAvatar(
    getModels(req),
    req.user.userId,
  );
  res.status(200).json({ status: "success", data: { profile } });
});

export const getActivity = catchAsync(async (req, res) => {
  const data = await meService.getMyActivity(
    getModels(req),
    req.user.userId,
    { limit: req.query.limit },
  );
  res.status(200).json({ status: "success", data });
});

export const getRecentWork = catchAsync(async (req, res) => {
  const data = await meService.getMyRecentWork(
    getModels(req),
    req.user.userId,
    { limit: req.query.limit },
  );
  res.status(200).json({ status: "success", data });
});
