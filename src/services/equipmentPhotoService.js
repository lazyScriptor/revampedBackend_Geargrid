import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Op } from "sequelize";
import AppError from "../utils/AppError.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { emitToTenant, emitToUser } from "../sockets/emitters.js";
import { getDeviceStatus } from "./deviceService.js";
import { loadImageMap, loadImageRules, matchEquipmentImageKey } from "../utils/equipmentImageRules.js";

// ─────────────────────────────────────────────────────────────────────────
// Equipment photos
//
// Two ways in, one way to store:
//   • the counter uploads a file (POST /api/equipment/:id/image)
//   • the counter asks its paired phone (createPhotoRequest); the phone opens
//     its camera and posts the shot (submitPhotoFromDevice)
// Browsers shrink the photo to WebP (JPEG where WebP encoding is missing)
// before upload, so the server only checks it: the real file bytes decide
// the type — the client's filename and mimetype are never trusted.
// ─────────────────────────────────────────────────────────────────────────

const UPLOADS_ROOT = path.resolve("uploads");
const EQUIPMENT_SUBDIR = "equipment";
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const PHOTO_REQUEST_TTL_MS = 5 * 60 * 1000;

const DEFAULT_IMAGE_BASE = (process.env.EQUIPMENT_IMAGE_BASE_URL || "https://app.geargrid.live/equipment/").replace(/\/?$/, "/");

const nowUtc = () => new Date();
const sanitizeTenantSlug = (tenantDbName) => String(tenantDbName || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");

/** "webp" | "jpg" | "png" from the file's first bytes, or null for anything else. */
export const detectImageType = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a) return "png";
  return null;
};

export const validateImageBuffer = (buffer) => {
  if (!buffer || buffer.length === 0) throw new AppError("No photo was received. Please try again.", 400);
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new AppError(`The photo is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`, 413);
  }
  const type = detectImageType(buffer);
  if (!type) throw new AppError("This file is not a supported photo. Use a JPG, PNG or WebP image.", 415);
  return type;
};

const ownUploadPath = (imageUrl) => {
  const prefix = `/uploads/${EQUIPMENT_SUBDIR}/`;
  if (typeof imageUrl !== "string" || !imageUrl.startsWith(prefix)) return null;
  const abs = path.resolve(UPLOADS_ROOT, imageUrl.slice("/uploads/".length));
  return abs.startsWith(path.join(UPLOADS_ROOT, EQUIPMENT_SUBDIR) + path.sep) ? abs : null;
};

const deleteOwnUpload = async (imageUrl) => {
  const abs = ownUploadPath(imageUrl);
  if (abs) await fs.unlink(abs).catch(() => {});
};

const defaultImageFor = (equipmentName) => {
  try {
    const key = matchEquipmentImageKey(equipmentName, loadImageRules());
    const file = key && loadImageMap()[key];
    return file ? `${DEFAULT_IMAGE_BASE}${file}` : null;
  } catch {
    return null;
  }
};

const findEquipment = async (models, equipmentId) => {
  const id = Number(equipmentId);
  if (!Number.isInteger(id) || id <= 0) throw new AppError("Invalid equipment id.", 400);
  const equipment = await models.Equipment.findByPk(id, { attributes: ["equipment_id", "equipment_name", "image_url"] });
  if (!equipment) throw new AppError("This machine no longer exists.", 404);
  return equipment;
};

/** Writes the photo, points the machine at it, removes the photo it replaces and tells open screens. */
export const saveEquipmentImage = async (models, { tenantDbName, equipmentId, buffer }) => {
  const type = validateImageBuffer(buffer);
  const equipment = await findEquipment(models, equipmentId);

  const relativeDir = path.join(EQUIPMENT_SUBDIR, sanitizeTenantSlug(tenantDbName));
  await fs.mkdir(path.join(UPLOADS_ROOT, relativeDir), { recursive: true });
  // A new name on every upload, so browsers and the CDN never show a cached old photo.
  const filename = `${equipment.equipment_id}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.${type}`;
  await fs.writeFile(path.join(UPLOADS_ROOT, relativeDir, filename), buffer);
  const imageUrl = `/uploads/${relativeDir.split(path.sep).join("/")}/${filename}`;

  const previous = equipment.image_url;
  try {
    await equipment.update({ image_url: imageUrl });
  } catch (err) {
    await deleteOwnUpload(imageUrl);
    throw err;
  }
  if (previous !== imageUrl) await deleteOwnUpload(previous);

  emitToTenant(tenantDbName, "equipment:image-updated", { equipment_id: equipment.equipment_id, image_url: imageUrl });
  return { equipment_id: equipment.equipment_id, image_url: imageUrl, bytes: buffer.length, type };
};

/** Drops an uploaded photo and goes back to the standard photo for the machine type (or none). */
export const resetEquipmentImage = async (models, { tenantDbName, equipmentId }) => {
  const equipment = await findEquipment(models, equipmentId);
  const previous = equipment.image_url;
  const fallback = defaultImageFor(equipment.equipment_name);
  await equipment.update({ image_url: fallback });
  await deleteOwnUpload(previous);
  emitToTenant(tenantDbName, "equipment:image-updated", { equipment_id: equipment.equipment_id, image_url: fallback });
  return { equipment_id: equipment.equipment_id, image_url: fallback };
};

// ── Phone photo requests ────────────────────────────────────────────────

const requestView = (row, equipment) => ({
  token: row.token,
  status: row.status,
  equipment_id: row.equipment_id,
  image_url: row.image_url || null,
  expires_at: row.expires_at,
  completed_at: row.completed_at || null,
  ...(equipment
    ? {
        equipment: {
          equipment_id: equipment.equipment_id,
          equipment_name: equipment.equipment_name,
          equipment_name_si: equipment.equipment_name_si || null,
          serial_number: equipment.serial_number || null,
          image_url: equipment.image_url || null,
        },
      }
    : {}),
});

const expireIfDue = async (row) => {
  if (row.status === "PENDING" && new Date(row.expires_at).getTime() <= Date.now()) {
    await row.update({ status: "EXPIRED" });
  }
  return row;
};

export const createPhotoRequest = async (models, { equipmentId, userId }) => {
  const equipment = await findEquipment(models, equipmentId);
  const phones = await models.OperatorDevice.count({ where: { user_id: userId } });
  if (!phones) {
    throw new AppError("No phone is paired to your account. Pair one in Profile → Signature → Paired phones.", 409);
  }
  // One open request per person: a new tap replaces whatever the phone was about to show.
  await models.PhotoRequest.update(
    { status: "CANCELLED" },
    { where: { requested_by_user_id: userId, status: "PENDING" } },
  );
  const row = await models.PhotoRequest.create({
    equipment_id: equipment.equipment_id,
    token: crypto.randomBytes(24).toString("base64url"),
    requested_by_user_id: userId,
    expires_at: new Date(nowUtc().getTime() + PHOTO_REQUEST_TTL_MS),
  });
  return requestView(row);
};

const findOwnRequest = async (models, token, userId) => {
  const row = await models.PhotoRequest.findOne({ where: { token: String(token || ""), requested_by_user_id: userId } });
  if (!row) throw new AppError("Photo request not found.", 404);
  return expireIfDue(row);
};

export const getPhotoRequest = async (models, { token, userId }) => requestView(await findOwnRequest(models, token, userId));

export const cancelPhotoRequest = async (models, { token, userId }) => {
  const row = await findOwnRequest(models, token, userId);
  if (row.status === "PENDING") await row.update({ status: "CANCELLED" });
  return requestView(row);
};

// ── Phone side (public, authorised by device_id + token) ────────────────

const resolveDevice = async (masterModels, deviceId) => {
  const status = await getDeviceStatus(masterModels, deviceId);
  if (!status.paired) throw new AppError("This phone is not paired any more.", 404);
  const models = initTenantModels(getCachedTenantConnection(status.tenant_db_name));
  return { status, models };
};

const EQUIPMENT_ATTRS = ["equipment_id", "equipment_name", "equipment_name_si", "serial_number", "image_url"];

export const listPendingPhotoRequestsForDevice = async (masterModels, deviceId) => {
  const { status, models } = await resolveDevice(masterModels, deviceId);
  const rows = await models.PhotoRequest.findAll({
    where: {
      requested_by_user_id: status.operator.user_id,
      status: "PENDING",
      expires_at: { [Op.gt]: nowUtc() },
    },
    include: [{ model: models.Equipment, attributes: EQUIPMENT_ATTRS }],
    order: [["createdAt", "DESC"]],
    limit: 5,
  });
  return { pending: rows.map((r) => requestView(r, r.Equipment)) };
};

const findDeviceRequest = async (models, operatorUserId, token) => {
  const row = await models.PhotoRequest.findOne({
    where: { token: String(token || ""), requested_by_user_id: operatorUserId },
    include: [{ model: models.Equipment, attributes: EQUIPMENT_ATTRS }],
  });
  if (!row) throw new AppError("This photo request was not found.", 404);
  return expireIfDue(row);
};

export const getPhotoRequestForDevice = async (masterModels, deviceId, token) => {
  const { status, models } = await resolveDevice(masterModels, deviceId);
  const row = await findDeviceRequest(models, status.operator.user_id, token);
  return requestView(row, row.Equipment);
};

export const submitPhotoFromDevice = async (masterModels, deviceId, token, buffer) => {
  const { status, models } = await resolveDevice(masterModels, deviceId);
  const row = await findDeviceRequest(models, status.operator.user_id, token);
  if (row.status === "CANCELLED") throw new AppError("The counter cancelled this photo request.", 410);
  if (row.status === "EXPIRED") throw new AppError("This photo request has expired. Ask the counter to tap the photo again.", 410);
  if (row.status === "COMPLETED") throw new AppError("A photo was already sent for this request.", 409);

  const saved = await saveEquipmentImage(models, {
    tenantDbName: status.tenant_db_name,
    equipmentId: row.equipment_id,
    buffer,
  });
  await row.update({ status: "COMPLETED", image_url: saved.image_url, completed_at: nowUtc() });
  emitToUser(status.tenant_db_name, status.operator.user_id, "photo:captured", {
    token: row.token,
    equipment_id: row.equipment_id,
    image_url: saved.image_url,
  });
  return requestView(row, row.Equipment);
};
