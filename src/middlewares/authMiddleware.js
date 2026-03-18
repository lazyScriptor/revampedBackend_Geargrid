import jwt from "jsonwebtoken";
import AppError from "../utils/AppError.js";

export const verifyToken = (req, res, next) => {
  // Check for token in your custom header OR the standard Authorization header
  const token =
    req.headers["x-access-token"] || req.headers.authorization?.split(" ")[1];

  if (!token) {
    // If no token, reject immediately
    return next(new AppError("No token provided. Please log in.", 401));
  }

  // Verify the token
  jwt.verify(
    token,
    process.env.JWT_SECRET || "fallback_secret",
    (err, decoded) => {
      if (err) {
        return next(
          new AppError(
            "Failed to authenticate token. It might be expired or invalid.",
            403,
          ),
        );
      }

      // Attach the decoded token payload (which contains userRole) to the request object
      // This allows subsequent controllers to know WHO made the request
      req.user = decoded;

      next(); // Proceed to the actual controller
    },
  );
};
