import * as activityService from "../services/activityService.js";
import * as activitySettingsService from "../services/activitySettingsService.js";
import * as activitySavedFiltersService from "../services/activitySavedFiltersService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) =>
  initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

const hasCheckPerm = (req) => {
  const perms = req.effectivePermissions;
  return Boolean(perms && (perms.has("*") || perms.has("activity:check")));
};

export const listActivity = catchAsync(async (req, res) => {
  const data = await activityService.listActivity(getModels(req), req.query, {
    userId: req.user.userId,
  });
  res.status(200).json({ status: "success", data });
});

export const getActivitySummary = catchAsync(async (req, res) => {
  const data = await activityService.getActivitySummary(getModels(req), req.query, {
    userId: req.user.userId,
    canCheck: hasCheckPerm(req),
  });
  res.status(200).json({ status: "success", data });
});

export const checkEvent = catchAsync(async (req, res) => {
  const event = await activityService.checkEvent(
    getModels(req),
    Number(req.params.id),
    req.user.userId,
  );
  res.status(200).json({
    status: "success",
    data: {
      event_id: event.event_id,
      checked_by: event.checked_by,
      checked_at: event.checked_at,
    },
  });
});

export const uncheckEvent = catchAsync(async (req, res) => {
  const event = await activityService.uncheckEvent(
    getModels(req),
    Number(req.params.id),
  );
  res.status(200).json({
    status: "success",
    data: {
      event_id: event.event_id,
      checked_by: null,
      checked_at: null,
    },
  });
});

export const listComments = catchAsync(async (req, res) => {
  const comments = await activityService.listComments(
    getModels(req),
    Number(req.params.id),
  );
  res.status(200).json({ status: "success", data: { comments } });
});

export const addComment = catchAsync(async (req, res) => {
  const comment = await activityService.addComment(
    getModels(req),
    Number(req.params.id),
    req.user.userId,
    req.body?.body,
  );
  res.status(201).json({ status: "success", data: { comment } });
});

export const markRead = catchAsync(async (req, res) => {
  const data = await activityService.markRead(
    getModels(req),
    req.body?.event_ids || req.body?.ids || [],
    req.user.userId,
  );
  res.status(200).json({ status: "success", data });
});

export const exportActivity = catchAsync(async (req, res) => {
  const buffer = await activityService.exportActivityExcel(getModels(req), req.query, {
    userId: req.user.userId,
  });
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=activity-export-${Date.now()}.xlsx`,
  );
  res.send(buffer);
});

export const getActivitySettings = catchAsync(async (req, res) => {
  const settings = await activitySettingsService.getActivitySettings(getModels(req));
  res.status(200).json({ status: "success", data: settings });
});

export const updateActivitySettings = catchAsync(async (req, res) => {
  const settings = await activitySettingsService.updateActivitySettings(
    getModels(req),
    req.body || {},
  );
  res.status(200).json({ status: "success", data: settings });
});

// ── Saved views on the Activity page (per user) ──
export const listSavedFilters = catchAsync(async (req, res) => {
  const filters = await activitySavedFiltersService.listSavedFilters(getModels(req), req.user.userId);
  res.status(200).json({ status: "success", data: { filters } });
});

export const createSavedFilter = catchAsync(async (req, res) => {
  const filter = await activitySavedFiltersService.createSavedFilter(getModels(req), req.user.userId, req.body || {});
  res.status(201).json({ status: "success", data: { filter } });
});

export const deleteSavedFilter = catchAsync(async (req, res) => {
  const data = await activitySavedFiltersService.deleteSavedFilter(getModels(req), req.user.userId, req.params.id);
  res.status(200).json({ status: "success", data });
});
