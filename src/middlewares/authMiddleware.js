import jwt from "jsonwebtoken";
import AppError from "../utils/AppError.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";

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

/**
 * Fine-grained permission middleware.
 * Checks if the user has a specific permission code (e.g. 'invoice:field:edit_discount')
 * by merging role-based permissions with per-user overrides.
 *
 * Usage: router.patch("/discount", protect, requirePermission("invoice:field:edit_discount"), controller)
 */
export const requirePermission = (action) => {
  return async (req, res, next) => {
    try {
      const connection = getCachedTenantConnection(req.user.tenantDbName);
      const models = initTenantModels(connection);

      // 1. Get role-based permissions
      const user = await models.User.findByPk(req.user.userId, {
        include: [
          {
            model: models.Role,
            attributes: ["role_id"],
            through: { attributes: [] },
            include: [
              {
                model: models.Permission,
                attributes: ["permission_id", "permission_code"],
                through: { attributes: [] },
              },
            ],
          },
        ],
      });

      if (!user) {
        return next(new AppError("User not found.", 404));
      }

      // Collect role permissions
      const rolePermissions = new Set();
      user.Roles?.forEach((role) => {
        role.Permissions?.forEach((perm) => {
          rolePermissions.add(perm.permission_code);
        });
      });

      // 2. Get user-level overrides
      const overrides = await models.UserPermissionOverride.findAll({
        where: { user_id: req.user.userId },
        include: [
          {
            model: models.Permission,
            attributes: ["permission_code"],
          },
        ],
      });

      // 3. Compute effective permissions: (role + grants) - revokes
      const effective = new Set(rolePermissions);
      for (const override of overrides) {
        const code = override.Permission?.permission_code;
        if (!code) continue;
        if (override.grant_type === "grant") {
          effective.add(code);
        } else if (override.grant_type === "revoke") {
          effective.delete(code);
        }
      }

      // 4. Check
      if (!effective.has(action)) {
        return next(
          new AppError(
            `You lack the required permission: ${action}`,
            403,
          ),
        );
      }

      // Attach effective permissions to req for downstream use
      req.effectivePermissions = effective;
      next();
    } catch (err) {
      return next(
        new AppError("Permission check failed: " + err.message, 500),
      );
    }
  };
};
