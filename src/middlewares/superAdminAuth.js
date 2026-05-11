import jwt from "jsonwebtoken";
import AppError from "../utils/AppError.js";
import { getMasterModels } from "../models/master/index.js";

const SUPER_ADMIN_SECRET =
  process.env.SUPER_ADMIN_JWT_SECRET || process.env.JWT_SECRET;

/**
 * Protects Super Admin routes.
 * Reads `superAdminToken` cookie, verifies against the SA-specific secret,
 * and attaches req.superAdmin.
 */
export const protectSuperAdmin = (req, res, next) => {
  const token = req.cookies.superAdminToken;
  if (!token) {
    return next(
      new AppError("Super Admin authentication required.", 401),
    );
  }

  try {
    const decoded = jwt.verify(token, SUPER_ADMIN_SECRET);
    if (!decoded.isSuperAdmin) {
      return next(new AppError("Invalid Super Admin token.", 403));
    }
    req.superAdmin = decoded;
    next();
  } catch (error) {
    return next(
      new AppError("Invalid or expired Super Admin token.", 401),
    );
  }
};

/**
 * Audit logging middleware factory.
 * Creates an AuditLog entry for every Super Admin action.
 * Usage: router.post("/suspend", logAuditAction("TENANT_SUSPENDED"), controller)
 */
export const logAuditAction = (action) => {
  return async (req, res, next) => {
    try {
      const { AuditLog } = getMasterModels();
      await AuditLog.create({
        super_admin_id: req.superAdmin.superAdminId,
        action,
        target_tenant_id: req.params.id || null,
        target_user_id: req.body?.targetUserId || null,
        ip_address:
          req.headers["x-forwarded-for"] || req.connection?.remoteAddress,
        metadata: {
          method: req.method,
          path: req.originalUrl,
          body: req.body,
        },
      });
    } catch (err) {
      console.error("Audit log failed:", err.message);
      // Don't block the request if audit logging fails
    }
    next();
  };
};
