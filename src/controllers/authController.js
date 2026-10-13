import jwt from "jsonwebtoken";
import * as authService from "../services/authService.js";
import * as meService from "../services/meService.js";
import catchAsync from "../utils/catchAsync.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";

// const cookieOptions = {
//   httpOnly: true,
//   secure: process.env.NODE_ENV === "production",
//   sameSite: "lax",
// };
// src/controllers/authController.js

const getCookieOptions = (req) => {
  const isHttps = req
    ? Boolean(req.secure) || req.headers["x-forwarded-proto"] === "https"
    : process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? "none" : "lax",
  };
};

const cookieOptions = getCookieOptions();


export const register = catchAsync(async (req, res, next) => {
  const { tenantId, email, username, password, firstName, lastName, nicNo } =
    req.body;

  const newUser = await authService.registerUser(
    tenantId,
    email,
    username,
    password,
    firstName,
    lastName,
    nicNo,
  );

  res.status(201).json({
    status: "success",
    message: "User created successfully in Master and Tenant databases.",
    user: { email: newUser.email, username: newUser.username },
  });
});

export const login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  const { accessToken, refreshToken, user } = await authService.loginUser(
    email,
    password,
  );

  const opts = getCookieOptions(req);

  // Set secure cookies
  res.cookie("accessToken", accessToken, {
    ...opts,
    maxAge: 5 * 60 * 60 * 1000,
  });
  res.cookie("refreshToken", refreshToken, {
    ...opts,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  // Best-effort: stamp last_login_at + last_login_ip. Login should not fail
  // if this audit write throws (e.g. older tenant DB without the new columns).
  try {
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      null;
    const decoded = jwt.decode(accessToken);
    if (decoded?.tenantDbName && decoded?.userId) {
      const connection = getCachedTenantConnection(decoded.tenantDbName);
      const models = initTenantModels(connection);
      await meService.recordLogin(models, decoded.userId, { ip });
    }
  } catch {
    // intentional: never fail login on audit-stamp failure
  }

  // Return user and access token for dual-layer authentication
  res.status(200).json({
    auth: true,
    user,
    token: accessToken,
    accessToken,
    refreshToken,
  });
});

export const refresh = catchAsync(async (req, res) => {
  let refreshToken = req.cookies?.refreshToken;
  if (!refreshToken && req.body?.refreshToken) {
    refreshToken = req.body.refreshToken;
  }
  if (!refreshToken && req.headers["x-refresh-token"]) {
    refreshToken = req.headers["x-refresh-token"];
  }

  if (!refreshToken) {
    return res
      .status(401)
      .json({ status: "fail", message: "No refresh token." });
  }

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    return res
      .status(401)
      .json({ status: "fail", message: "Invalid or expired refresh token." });
  }

  const tokenPayload = {
    userId: decoded.userId,
    username: decoded.username,
    roles: decoded.roles,
    roleHierarchyLevel: decoded.roleHierarchyLevel,
    warehouseId: decoded.warehouseId,
    tenantDbName: decoded.tenantDbName,
  };

  const newAccessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });

  const opts = getCookieOptions(req);

  res.cookie("accessToken", newAccessToken, {
    ...opts,
    maxAge: 5 * 60 * 60 * 1000,
  });

  res.status(200).json({
    status: "success",
    message: "Token refreshed.",
    token: newAccessToken,
    accessToken: newAccessToken,
  });
});

export const logout = (req, res) => {
  res.clearCookie("accessToken");
  res.clearCookie("refreshToken");
  res.status(200).json({ status: "success", message: "Logged out." });
};

export const verifyAuth = (req, res) => {
  // If the request made it past the `protect` middleware, the session is valid!
  res.status(200).json({
    auth: true,
    user: {
      id: req.user.userId,
      username: req.user.username,
      roles: req.user.roles,
      warehouseId: req.user.warehouseId,
      tenantDbName: req.user.tenantDbName,
    },
  });
};
