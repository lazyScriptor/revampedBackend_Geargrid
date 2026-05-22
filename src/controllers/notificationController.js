import * as notificationService from "../services/notificationService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

export const listNotifications = catchAsync(async (req, res) => {
  const items = await notificationService.listNotifications(
    getModels(req),
    req.user.userId,
    {
      limit: req.query.limit,
      before: req.query.before,
      unreadOnly: req.query.unread === "true",
    },
  );
  res.status(200).json({ status: "success", data: { notifications: items } });
});

export const unreadCount = catchAsync(async (req, res) => {
  const count = await notificationService.getUnreadCount(
    getModels(req),
    req.user.userId,
  );
  res.status(200).json({ status: "success", data: { count } });
});

export const markRead = catchAsync(async (req, res) => {
  const row = await notificationService.markAsRead(
    getModels(req),
    req.params.id,
    req.user.userId,
  );
  res.status(200).json({ status: "success", data: { notification: row } });
});

export const markAllRead = catchAsync(async (req, res) => {
  const result = await notificationService.markAllAsRead(
    getModels(req),
    req.user.userId,
  );
  res.status(200).json({ status: "success", data: result });
});

export const removeNotification = catchAsync(async (req, res) => {
  const result = await notificationService.deleteNotification(
    getModels(req),
    req.params.id,
    req.user.userId,
  );
  res.status(200).json({ status: "success", data: result });
});
