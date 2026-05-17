import jwt from "jsonwebtoken";
import * as authService from "../services/authService.js";
import catchAsync from "../utils/catchAsync.js";

// const cookieOptions = {
//   httpOnly: true,
//   secure: process.env.NODE_ENV === "production",
//   sameSite: "lax",
// };
// src/controllers/authController.js

const cookieOptions = {
  httpOnly: true,
  // Must be true for 'none' to work
  secure: true,
  // 'none' allows cross-domain cookies (localhost -> geargrid.live)
  sameSite: process.env.NODE_ENV === "production" ? "lax" : "none",
};


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

  // Set secure cookies
  res.cookie("accessToken", accessToken, {
    ...cookieOptions,
    maxAge: 5 * 60 * 60 * 1000,
  });
  res.cookie("refreshToken", refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.status(200).json({ auth: true, user });
});

export const refresh = catchAsync(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;
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

  res.cookie("accessToken", newAccessToken, {
    ...cookieOptions,
    maxAge: 5 * 60 * 60 * 1000,
  });

  res.status(200).json({ status: "success", message: "Token refreshed." });
});

export const verifyAuth = (req, res) => {
  // If the request made it past the `protect` middleware, the cookie is valid!
  res.status(200).json({
    auth: true,
    user: {
      id: req.user.userId,
      username: req.user.username,
      roles: req.user.roles,
      warehouseId: req.user.warehouseId,
      tenantDbName: req.user.tenantDbName, // The frontend doesn't need this, but it proves it works!
    },
  });
};
