import jwt from "jsonwebtoken";
import AppError from "../utils/AppError.js";

export const protect = (req, res, next) => {
  // 1. Check if the accessToken cookie exists
  const token = req.cookies.accessToken;
  if (!token) {
    return next(
      new AppError("You are not logged in. Please log in to get access.", 401),
    );
  }

  try {
    // 2. Verify the token signature
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. Attach the decoded user data (including the tenantDbName!) to the request
    req.user = decoded;

    next();
  } catch (error) {
    return next(
      new AppError("Invalid or expired token. Please log in again.", 401),
    );
  }
};

// Role-based access control middleware factory
// Usage: router.use(protect, restrictTo('Admin', 'Manager'))
export const restrictTo = (...roles) => {
  const allowedRoles = roles.map((r) => r.toLowerCase());
  return (req, res, next) => {
    const userRoles = req.user?.roles || [];
    const hasAccess = userRoles.some((role) =>
      allowedRoles.includes(role.toLowerCase()),
    );

    if (!hasAccess) {
      return next(
        new AppError(
          "You do not have permission to perform this action.",
          403,
        ),
      );
    }
    next();
  };
};
