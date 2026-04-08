import * as equipmentService from "../services/equipmentService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

export const createEquipment = catchAsync(async (req, res, next) => {
  const newEquipment = await equipmentService.createEquipment(
    getModels(req),
    req.body,
  );
  res
    .status(201)
    .json({ status: "success", data: { equipment: newEquipment } });
});

export const getEquipment = catchAsync(async (req, res, next) => {
  // Pass req.query directly to the service to handle search/filters/pagination
  const result = await equipmentService.getAllEquipment(
    getModels(req),
    req.query,
  );
  res.status(200).json({ status: "success", data: result });
});

export const getSingleEquipment = catchAsync(async (req, res, next) => {
  const equipment = await equipmentService.getEquipmentById(
    getModels(req),
    req.params.id,
  );
  res.status(200).json({ status: "success", data: { equipment } });
});

export const updateEquipment = catchAsync(async (req, res, next) => {
  const updatedEquipment = await equipmentService.updateEquipment(
    getModels(req),
    req.params.id,
    req.body,
  );
  res
    .status(200)
    .json({ status: "success", data: { equipment: updatedEquipment } });
});

export const changeStatus = catchAsync(async (req, res, next) => {
  const { status } = req.body;
  const updatedEquipment = await equipmentService.updateEquipmentStatus(
    getModels(req),
    req.params.id,
    status,
  );
  res
    .status(200)
    .json({ status: "success", data: { equipment: updatedEquipment } });
});
