import * as authService from "../services/authService.js";
import catchAsync from "../utils/catchAsync.js";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
};

// ==========================================
// 1. REGISTER (Setup First User)
// ==========================================
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

// ==========================================
// 2. LOGIN
// ==========================================
export const login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  const { accessToken, refreshToken, user } = await authService.loginUser(
    email,
    password,
  );

  // Set secure cookies
  res.cookie("accessToken", accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie("refreshToken", refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.status(200).json({ auth: true, user });
});

// ==========================================
// 3. VERIFY TOKEN (Protected Route)
// ==========================================
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
