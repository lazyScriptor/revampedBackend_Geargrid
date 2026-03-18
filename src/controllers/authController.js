import * as authService from "../services/authService.js";
import catchAsync from "../utils/catchAsync.js";

// API 1: Login (Generates the token)
export const login = catchAsync(async (req, res, next) => {
  const { username, password, role } = req.body;

  const loginData = await authService.loginUser(username, password, role);

  res.status(200).json({
    auth: true,
    ...loginData,
  });
});

// API 2: Verify (Checks the token)
export const verifyAuth = (req, res) => {
  // If the request reaches this function, it means the verifyToken middleware passed successfully.
  res.status(200).json({
    auth: true,
    message: "You have a valid token",
    userRole: req.user.userRole, // We extracted this from the token in the middleware!
  });
};
