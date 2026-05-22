import bcrypt from "bcrypt";
import path from "path";
import fs from "fs";
import { Op } from "sequelize";
import AppError from "../utils/AppError.js";

// Fields the user is allowed to update on themselves. Everything else
// (username/email/roles/permissions/warehouse) is admin-only.
const SELF_EDITABLE_PROFILE_FIELDS = [
  "first_name",
  "last_name",
  "phone_number",
  "address_line1",
  "address_line2",
  "job_title",
  "bio",
];

const SELF_EDITABLE_PREFERENCE_FIELDS = [
  "language",
  "timezone",
  "date_format",
  "time_format",
  "notification_prefs",
];

const PUBLIC_USER_ATTRS = [
  "user_id",
  "warehouse_id",
  "username",
  "email",
  "first_name",
  "last_name",
  "nic_no",
  "phone_number",
  "address_line1",
  "address_line2",
  "is_active",
  "avatar_url",
  "job_title",
  "bio",
  "language",
  "timezone",
  "date_format",
  "time_format",
  "notification_prefs",
  "last_login_at",
  "last_login_ip",
  "password_changed_at",
  "createdAt",
  "updatedAt",
];

const sanitize = (row) => {
  if (!row) return null;
  const json = typeof row.toJSON === "function" ? row.toJSON() : { ...row };
  delete json.password_hash;
  return json;
};

const loadUser = async (models, userId) => {
  const user = await models.User.findByPk(userId, {
    attributes: PUBLIC_USER_ATTRS.concat(["password_hash"]),
    include: [
      {
        model: models.Role,
        through: { attributes: [] },
        attributes: ["role_id", "role_name", "hierarchy_level"],
      },
    ],
  });
  if (!user) throw new AppError("User not found.", 404);
  return user;
};

const loadPermissionsForUser = async (models, userId) => {
  const user = await models.User.findByPk(userId, {
    include: [
      {
        model: models.Role,
        through: { attributes: [] },
        include: [
          {
            model: models.Permission,
            through: { attributes: [] },
            attributes: ["permission_code"],
          },
        ],
      },
    ],
  });
  if (!user) return [];
  const codes = new Set();
  for (const role of user.Roles || []) {
    for (const p of role.Permissions || []) {
      if (p.permission_code) codes.add(p.permission_code);
    }
  }
  // Apply per-user overrides if the model exists
  if (models.UserPermissionOverride) {
    const overrides = await models.UserPermissionOverride.findAll({
      where: { user_id: userId },
      include: [{ model: models.Permission, attributes: ["permission_code"] }],
    });
    for (const ov of overrides) {
      const code = ov.Permission?.permission_code;
      if (!code) continue;
      if (ov.granted) codes.add(code);
      else codes.delete(code);
    }
  }
  return Array.from(codes);
};

export const getMyProfile = async (models, userId) => {
  const user = await loadUser(models, userId);
  const json = sanitize(user);
  json.permissions = await loadPermissionsForUser(models, userId);
  return json;
};

export const updateMyProfile = async (models, userId, payload) => {
  const updates = {};
  for (const key of SELF_EDITABLE_PROFILE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      updates[key] = payload[key];
    }
  }
  if (Object.keys(updates).length === 0) {
    return getMyProfile(models, userId);
  }
  await models.User.update(updates, { where: { user_id: userId } });
  return getMyProfile(models, userId);
};

export const updateMyPreferences = async (models, userId, payload) => {
  const updates = {};
  for (const key of SELF_EDITABLE_PREFERENCE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      updates[key] = payload[key];
    }
  }
  if (updates.time_format && !["12h", "24h"].includes(updates.time_format)) {
    throw new AppError("time_format must be '12h' or '24h'.", 400);
  }
  if (Object.keys(updates).length === 0) {
    return getMyProfile(models, userId);
  }
  await models.User.update(updates, { where: { user_id: userId } });
  return getMyProfile(models, userId);
};

export const changeMyPassword = async (
  models,
  userId,
  { currentPassword, newPassword },
) => {
  if (!currentPassword || !newPassword) {
    throw new AppError("currentPassword and newPassword are both required.", 400);
  }
  if (newPassword.length < 8) {
    throw new AppError("New password must be at least 8 characters.", 400);
  }
  if (currentPassword === newPassword) {
    throw new AppError("New password must differ from the current password.", 400);
  }

  const user = await models.User.findByPk(userId, {
    attributes: ["user_id", "password_hash"],
  });
  if (!user) throw new AppError("User not found.", 404);

  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) throw new AppError("Current password is incorrect.", 400);

  const newHash = await bcrypt.hash(newPassword, 10);
  await models.User.update(
    { password_hash: newHash, password_changed_at: new Date() },
    { where: { user_id: userId } },
  );
  return { ok: true };
};

// ── Avatar ─────────────────────────────────────────────────────────────────
const AVATAR_DIR_REL = "uploads/avatars";
const AVATAR_DIR_ABS = path.resolve(process.cwd(), AVATAR_DIR_REL);

const ensureAvatarDir = () => {
  if (!fs.existsSync(AVATAR_DIR_ABS)) {
    fs.mkdirSync(AVATAR_DIR_ABS, { recursive: true });
  }
};

export const setMyAvatar = async (models, userId, file) => {
  if (!file) throw new AppError("No avatar file uploaded.", 400);
  if (!file.mimetype?.startsWith("image/")) {
    throw new AppError("Avatar must be an image.", 400);
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new AppError("Avatar must be 5 MB or smaller.", 400);
  }

  ensureAvatarDir();
  const ext = (file.originalname?.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const safeExt = ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext) ? ext : "png";
  const filename = `user_${userId}_${Date.now()}.${safeExt}`;
  const fullPath = path.join(AVATAR_DIR_ABS, filename);
  fs.writeFileSync(fullPath, file.buffer);

  const publicUrl = `/${AVATAR_DIR_REL}/${filename}`;

  // Delete the old avatar file (if any and if it lives under our avatar dir)
  const existing = await models.User.findByPk(userId, { attributes: ["avatar_url"] });
  if (existing?.avatar_url && existing.avatar_url.startsWith(`/${AVATAR_DIR_REL}/`)) {
    const oldAbs = path.resolve(process.cwd(), existing.avatar_url.replace(/^\//, ""));
    if (oldAbs.startsWith(AVATAR_DIR_ABS) && fs.existsSync(oldAbs)) {
      try { fs.unlinkSync(oldAbs); } catch { /* ignore */ }
    }
  }

  await models.User.update({ avatar_url: publicUrl }, { where: { user_id: userId } });
  return getMyProfile(models, userId);
};

export const removeMyAvatar = async (models, userId) => {
  const existing = await models.User.findByPk(userId, { attributes: ["avatar_url"] });
  if (existing?.avatar_url?.startsWith(`/${AVATAR_DIR_REL}/`)) {
    const abs = path.resolve(process.cwd(), existing.avatar_url.replace(/^\//, ""));
    if (abs.startsWith(AVATAR_DIR_ABS) && fs.existsSync(abs)) {
      try { fs.unlinkSync(abs); } catch { /* ignore */ }
    }
  }
  await models.User.update({ avatar_url: null }, { where: { user_id: userId } });
  return getMyProfile(models, userId);
};

// ── Activity (uses existing notifications + bulk jobs as proxy) ────────────
export const getMyActivity = async (models, userId, { limit = 25 } = {}) => {
  const safeLimit = Math.min(Number(limit) || 25, 100);

  const [notifications, bulkJobs] = await Promise.all([
    models.Notification
      ? models.Notification.findAll({
          where: { user_id: userId },
          order: [["createdAt", "DESC"]],
          limit: safeLimit,
        })
      : [],
    models.BulkJob
      ? models.BulkJob.findAll({
          where: { user_id: userId },
          order: [["createdAt", "DESC"]],
          limit: safeLimit,
        })
      : [],
  ]);

  return {
    notifications: notifications.map((n) =>
      typeof n.toJSON === "function" ? n.toJSON() : n,
    ),
    bulk_jobs: bulkJobs.map((j) =>
      typeof j.toJSON === "function" ? j.toJSON() : j,
    ),
  };
};

// Recent invoices the user created (rough "sessions"/recent-work proxy)
export const getMyRecentWork = async (models, userId, { limit = 10 } = {}) => {
  const safeLimit = Math.min(Number(limit) || 10, 50);
  const where = { issued_by_user_id: userId };
  const [invoices, payments] = await Promise.all([
    models.Invoice.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: safeLimit,
      attributes: ["invoice_id", "status", "grand_total", "createdAt"],
    }).catch(() => []),
    models.Payment
      ? models.Payment.findAll({
          where: { received_by_user_id: userId },
          order: [["createdAt", "DESC"]],
          limit: safeLimit,
          attributes: ["payment_id", "invoice_id", "payment_amount", "method", "createdAt"],
        }).catch(() => [])
      : [],
  ]);
  return {
    recent_invoices: invoices.map((i) =>
      typeof i.toJSON === "function" ? i.toJSON() : i,
    ),
    recent_payments: payments.map((p) =>
      typeof p.toJSON === "function" ? p.toJSON() : p,
    ),
  };
};

export const recordLogin = async (models, userId, { ip }) => {
  try {
    await models.User.update(
      { last_login_at: new Date(), last_login_ip: ip || null },
      { where: { user_id: userId } },
    );
  } catch {
    // Non-fatal — login flow proceeds even if the audit columns can't be written.
  }
};
