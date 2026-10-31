import multer from "multer";
import * as photoService from "../services/equipmentPhotoService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { getMasterModels } from "../models/master/index.js";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) => initTenantModels(getCachedTenantConnection(req.user.tenantDbName));
const ok = (res, data) => res.status(200).json({ status: "success", data });

// Memory storage: the file is checked byte-for-byte before anything touches disk.
const multerSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: photoService.MAX_IMAGE_BYTES, files: 1 },
}).single("image");

/** multer with its errors turned into messages people can act on. */
export const receivePhoto = (req, res, next) =>
  multerSingle(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return next(new AppError(`The photo is too large (max ${photoService.MAX_IMAGE_BYTES / 1024 / 1024} MB).`, 413));
    }
    return next(new AppError("The photo could not be received. Please try again.", 400));
  });

export const uploadImage = catchAsync(async (req, res) => {
  ok(
    res,
    await photoService.saveEquipmentImage(getModels(req), {
      tenantDbName: req.user.tenantDbName,
      equipmentId: req.params.id,
      buffer: req.file?.buffer,
    }),
  );
});

export const resetImage = catchAsync(async (req, res) => {
  ok(res, await photoService.resetEquipmentImage(getModels(req), { tenantDbName: req.user.tenantDbName, equipmentId: req.params.id }));
});

export const createPhotoRequest = catchAsync(async (req, res) => {
  ok(res, await photoService.createPhotoRequest(getModels(req), { equipmentId: req.params.id, userId: req.user.userId }));
});

export const getPhotoRequest = catchAsync(async (req, res) => {
  ok(res, await photoService.getPhotoRequest(getModels(req), { token: req.params.token, userId: req.user.userId }));
});

export const cancelPhotoRequest = catchAsync(async (req, res) => {
  ok(res, await photoService.cancelPhotoRequest(getModels(req), { token: req.params.token, userId: req.user.userId }));
});

// ── phone (public) ──
export const devicePendingPhotos = catchAsync(async (req, res) => {
  ok(res, await photoService.listPendingPhotoRequestsForDevice(getMasterModels(), req.params.device_id));
});

export const deviceGetPhotoRequest = catchAsync(async (req, res) => {
  ok(res, await photoService.getPhotoRequestForDevice(getMasterModels(), req.params.device_id, req.params.token));
});

export const deviceSubmitPhoto = catchAsync(async (req, res) => {
  ok(res, await photoService.submitPhotoFromDevice(getMasterModels(), req.params.device_id, req.params.token, req.file?.buffer));
});
