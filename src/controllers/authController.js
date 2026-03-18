import * as authService from "../services/authService.js";
import catchAsync from "../utils/catchAsync.js";
import jwt from "jsonwebtoken";
import AppError from "../utils/AppError.js";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV == "production",
  sameSite: "lax", // <--- CHANGE THIS FROM 'strict' TO 'lax'
};

export const login = catchAsync(async (req, res, next) => {
  const { username, password, role } = req.body;
  const { accessToken, refreshToken, result } = await authService.loginUser(
    username,
    password,
    role,
  );

  // Send tokens as HttpOnly cookies
  res.cookie("accessToken", accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000,
  }); // 15 mins
  res.cookie("refreshToken", refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  }); // 7 days

  res.status(200).json({ auth: true, result, username });
});

export const refresh = catchAsync(async (req, res, next) => {
  const incomingRefreshToken = req.cookies.refreshToken;

  if (!incomingRefreshToken) {
    return next(
      new AppError("No refresh token found. Please log in again.", 401),
    );
  }

  // Verify the refresh token
  jwt.verify(
    incomingRefreshToken,
    process.env.JWT_REFRESH_SECRET || "fallback_refresh_secret",
    (err, decoded) => {
      if (err)
        return next(new AppError("Invalid or expired refresh token.", 403));

      // Issue a NEW Access Token
      const newAccessToken = jwt.sign(
        { userRole: decoded.userRole, username: decoded.username },
        process.env.JWT_SECRET || "fallback_secret",
        { expiresIn: "15m" },
      );

      res.cookie("accessToken", newAccessToken, {
        ...cookieOptions,
        maxAge: 15 * 60 * 1000,
      });
      res
        .status(200)
        .json({ auth: true, message: "Token refreshed successfully" });
    },
  );
});

export const logout = (req, res) => {
  res.clearCookie("accessToken");
  res.clearCookie("refreshToken");
  res.status(200).json({ auth: false, message: "Logged out successfully" });
};

export const verifyAuth = (req, res) => {
  res.status(200).json({
    auth: true,
    message: "You have a valid token",
    userRole: req.user.userRole,
  });
};
export const getRolesByUsername = catchAsync(async (req, res) => {
  const roles = await authService.getUserRoles(req.params.username);
  res.status(200).json(roles);
});
