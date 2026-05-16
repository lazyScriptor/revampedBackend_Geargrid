import jwt from "jsonwebtoken";
import AppError from "../utils/AppError.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";

// 5-minute in-process cache for tenant subscription status
const tenantStatusCache = new Map();
const STATUS_CACHE_TTL = 5 * 60 * 1000;

export const protect = async (req, res, next) => {
  const token = req.cookies.accessToken;
  if (!token) {
    return next(
      new AppError("You are not logged in. Please log in to get access.", 401),
    );
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    // Check subscription status — skip for impersonation tokens (SA already validated)
    if (decoded.tenantDbName && !decoded.isImpersonation) {
      const cacheKey = decoded.tenantDbName;
      const cached = tenantStatusCache.get(cacheKey);
      const now = Date.now();

      let status = "Active";
      if (cached && now - cached.cachedAt < STATUS_CACHE_TTL) {
        status = cached.status;
      } else {
        try {
          const { getMasterModels } = await import("../models/master/index.js");
          const { Tenant } = getMasterModels();
          const tenant = await Tenant.findOne({
            where: { db_name: decoded.tenantDbName },
            attributes: ["subscription_status"],
          });
          status = tenant?.subscription_status || "Active";
          tenantStatusCache.set(cacheKey, { status, cachedAt: now });
        } catch {
          // Master DB unreachable — fail open to avoid locking out tenants on infra issues
        }
      }

      if (status === "Suspended") {
        return next(
          new AppError(
            "Your account has been suspended. Please contact GearGrid support.",
            403,
          ),
        );
      }
      if (status === "Overdue") {
        return next(
          new AppError(
            "Your subscription payment is overdue. Please settle your account to regain access.",
            403,
          ),
        );
      }
    }

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
      const userRoleList = userRoles.join(', ') || 'none';
      const requiredRoleList = roles.join(', ');
      return next(
        new AppError(
          `Access denied. This action requires one of these roles: [${requiredRoleList}]. Your current roles: [${userRoleList}].`,
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
            include: [
              {
                model: models.Permission,
                attributes: ["permission_id", "permission_code"],
                through: { attributes: [] },
              },
            ],
            attributes: ["role_id", "hierarchy_level"],
          },
        ],
      });

      if (!user) {
        return next(new AppError("User not found.", 404));
      }

      // Collect role permissions and find highest hierarchy level
      const rolePermissions = new Set();
      let maxHierarchy = 0;
      user.Roles?.forEach((role) => {
        if (role.hierarchy_level > maxHierarchy) maxHierarchy = role.hierarchy_level;
        role.Permissions?.forEach((perm) => {
          rolePermissions.add(perm.permission_code);
        });
      });
      req.user.roleHierarchyLevel = maxHierarchy;

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
            `Permission denied. The action "${action}" is required but not granted to your account. Contact your administrator to request this permission.`,
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

export const logTenantAuditAction = (action) => {
  return async (req, res, next) => {
    try {
      const { getMasterModels } = await import("../models/master/index.js");
      const { AuditLog, Tenant } = getMasterModels();
      
      const tenant = await Tenant.findOne({ where: { db_name: req.user.tenantDbName } });
      const tenantId = tenant ? tenant.tenant_id : null;

      await AuditLog.create({
        super_admin_id: null,
        actor_user_id: req.user.userId,
        action,
        target_tenant_id: tenantId,
        target_user_id: req.params.id || null,
        ip_address: req.headers["x-forwarded-for"] || req.connection?.remoteAddress,
        metadata: {
          method: req.method,
          path: req.originalUrl,
          body: req.body,
        },
      });
    } catch (err) {
      console.error("Tenant audit log failed:", err.message);
    }
    next();
  };
};
