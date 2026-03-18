import jwt from "jsonwebtoken";
import AppError from "../utils/AppError.js";

export const verifyToken = (req, res, next) => {
  // Read the token directly from the parsed cookies!
  const token = req.cookies.accessToken;

  if (!token) {
    return next(new AppError("No token provided.", 401));
  }

  jwt.verify(
    token,
    process.env.JWT_SECRET || "fallback_secret",
    (err, decoded) => {
      if (err) {
        // We send a specific message so the frontend knows it's an expired token
        return next(new AppError("TokenExpired", 401));
      }
      req.user = decoded;
      next();
    },
  );
};
