import { Op } from "sequelize";
import { emitToUser } from "../sockets/emitters.js";
import AppError from "../utils/AppError.js";

const sanitize = (row) => (row && typeof row.toJSON === "function" ? row.toJSON() : row);

export const listNotifications = async (
  models,
  userId,
  { limit = 30, before = null, unreadOnly = false } = {},
) => {
  const where = { user_id: userId };
  if (unreadOnly) where.read_at = null;
  if (before) where.createdAt = { [Op.lt]: new Date(before) };

  const rows = await models.Notification.findAll({
    where,
    order: [["createdAt", "DESC"]],
    limit: Math.min(Number(limit) || 30, 100),
  });

  return rows.map(sanitize);
};

export const getUnreadCount = async (models, userId) =>
  models.Notification.count({ where: { user_id: userId, read_at: null } });

export const markAsRead = async (models, notificationId, userId) => {
  const row = await models.Notification.findOne({
    where: { notification_id: notificationId, user_id: userId },
  });
  if (!row) throw new AppError("Notification not found.", 404);
  if (!row.read_at) {
    row.read_at = new Date();
    await row.save();
  }
  return sanitize(row);
};

export const markAllAsRead = async (models, userId) => {
  const [count] = await models.Notification.update(
    { read_at: new Date() },
    { where: { user_id: userId, read_at: null } },
  );
  return { updated: count };
};

export const deleteNotification = async (models, notificationId, userId) => {
  const deleted = await models.Notification.destroy({
    where: { notification_id: notificationId, user_id: userId },
  });
  if (!deleted) throw new AppError("Notification not found.", 404);
  return { deleted: true };
};

/**
 * Persist a notification AND emit it over the websocket.
 * Called from background workers and other services — never from controllers
 * directly (controllers should pipe user actions through their own services).
 */
export const createNotification = async (
  models,
  {
    userId,
    type = "info",
    category = null,
    title,
    message = null,
    payload = null,
    link = null,
  },
) => {
  if (!userId || !title) {
    throw new Error("createNotification requires userId and title");
  }

  const row = await models.Notification.create({
    user_id: userId,
    type,
    category,
    title,
    message,
    payload,
    link,
  });

  const json = sanitize(row);
  emitToUser(userId, "notification:new", json);
  return json;
};
