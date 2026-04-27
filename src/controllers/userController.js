import * as userService from "../services/userService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

// --- GENERAL USERS ---
export const getUsers = catchAsync(async (req, res, next) => {
  const users = await userService.getAllUsers(getModels(req));
  res.status(200).json({ status: "success", data: { users } });
});

export const toggleUserStatus = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { isActive } = req.body;

  if (req.user.id === parseInt(id)) {
    return res.status(403).json({
      status: "fail",
      message: "You cannot deactivate your own account.",
    });
  }

  const updatedUser = await userService.updateUserStatus(
    getModels(req),
    id,
    isActive,
  );
  res.status(200).json({ status: "success", data: { user: updatedUser } });
});

export const assignRoles = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { roleIds } = req.body;

  const user = await userService.assignUserRoles(getModels(req), id, roleIds);
  res.status(200).json({ status: "success", data: { user } });
});

// --- WORKFORCE SPECIFIC ---
export const getTechnicianRoster = catchAsync(async (req, res) => {
  const roster = await userService.getTechniciansWithWorkload(getModels(req));
  res.status(200).json({ status: "success", data: { roster } });
});

export const addTechnician = catchAsync(async (req, res) => {
  const tech = await userService.createTechnician(getModels(req), req.body);
  res
    .status(201)
    .json({ status: "success", message: "Technician added.", data: { tech } });
});

export const editTechnician = catchAsync(async (req, res) => {
  const tech = await userService.updateTechnician(
    getModels(req),
    req.params.id,
    req.body,
  );
  res.status(200).json({
    status: "success",
    message: "Technician updated.",
    data: { tech },
  });
});
