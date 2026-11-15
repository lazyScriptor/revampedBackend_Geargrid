import AppError from "../utils/AppError.js";
import { STATUS_CACHE_TTL, tenantStatusCache } from "../utils/tenantStatusCache.js";
import { isPaymentLocked } from "../config/paymentNotice.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { getMasterModels } from "../models/master/index.js";
import { matchesDeviceToken } from "../services/deviceService.js";

const LAST_SEEN_THROTTLE_MS = 60_000;
const PAIR_AGAIN_MSG = "Device authentication failed. Please pair this phone again.";
const PENDING_ALLOWED_PATHS = new Set(["/register", "/unpair", "/token/rotate", "/policy"]);

/**
 * Log why a phone was refused before answering 401, so a pairing problem can be traced from the
 * server logs. Never logs the token; the device id is shortened.
 */
const refuse = (next, req, reason) => {
  const id = String(req.headers["x-device-id"] || "").slice(0, 14);
  console.warn(`deviceAuth 401 ${reason} ${req.method} ${String(req.originalUrl || req.url || "").split("?")[0]} device=${id || "-"}`);
  return next(new AppError(PAIR_AGAIN_MSG, 401, "device_revoked"));
};

const getActiveTenantStatus = async (tenantDb) => {
  const now = Date.now();
  const cached = tenantStatusCache.get(tenantDb);
  if (cached && now - cached.cachedAt < STATUS_CACHE_TTL && cached.status !== "__missing__") {
    return cached;
  }

  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({
    where: { db_name: tenantDb },
    attributes: ["subscription_status", "feature_flags"],
  });
  if (!tenant) return null;

  const flags =
    typeof tenant.feature_flags === "string"
      ? JSON.parse(tenant.feature_flags)
      : tenant.feature_flags;
  const entry = {
    status: tenant.subscription_status,
    paymentNotice: flags?.payment_notice ?? null,
    cachedAt: now,
  };
  tenantStatusCache.set(tenantDb, entry);
  return entry;
};

/**
 * Authenticate native/paired device requests via:
 *   x-device-id, x-tenant-db, Authorization: Bearer <device_token>.
 * Sets req.device, req.tenantModels, req.tenantDbName.
 */
export const deviceAuth = async (req, res, next) => {
  try {
    const deviceId = String(req.headers["x-device-id"] || "").trim();
    const tenantDb = String(req.headers["x-tenant-db"] || "").trim();
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!deviceId || !tenantDb || !token) {
      const missing = [!deviceId && "device_id", !tenantDb && "tenant_db", !token && "token"].filter(Boolean);
      return refuse(next, req, `missing_headers:${missing.join(",")}`);
    }

    const tenantInfo = await getActiveTenantStatus(tenantDb);
    if (!tenantInfo) {
      return refuse(next, req, "unknown_shop");
    }
    if (tenantInfo.status !== "Active") {
      return next(new AppError("Shop subscription is currently inactive.", 403, "shop_inactive"));
    }
    if (isPaymentLocked(tenantInfo.status, tenantInfo.paymentNotice, Date.now())) {
      return next(
        new AppError("Subscription payment is overdue. Please settle your account.", 403, "shop_inactive"),
      );
    }

    const tenantConnection = getCachedTenantConnection(tenantDb);
    const tenantModels = initTenantModels(tenantConnection);
    const device = await tenantModels.OperatorDevice.findOne({ where: { device_id: deviceId } });

    if (!device) return refuse(next, req, "unknown_device");
    if (device.status === "REVOKED") return refuse(next, req, "device_revoked");
    if (!matchesDeviceToken(token, device)) return refuse(next, req, "token_mismatch");

    // Verify paired user still exists and is active (A-03), loading roles/permissions for route checks (A-04)
    if (tenantModels.User?.findByPk) {
      const roleInclude = tenantModels.Role
        ? [
            {
              model: tenantModels.Role,
              attributes: ["role_id", "role_name", "hierarchy_level", "is_active"],
              through: { attributes: [] },
              ...(tenantModels.Permission
                ? {
                    include: [
                      {
                        model: tenantModels.Permission,
                        attributes: ["permission_code"],
                        through: { attributes: [] },
                      },
                    ],
                  }
                : {}),
            },
          ]
        : [];
      const user = await tenantModels.User.findByPk(device.user_id, {
        attributes: ["user_id", "is_active"],
        ...(roleInclude.length > 0 ? { include: roleInclude } : {}),
      });
      if (!user || user.is_active === false) {
        return refuse(next, req, user ? "user_inactive" : "user_missing");
      }
      req.deviceUser = user;
    }

    if (device.status === "SUSPENDED") {
      return next(
        new AppError("This phone is suspended by your administrator.", 403, "device_suspended"),
      );
    }
    if (device.status === "PENDING") {
      const subPath = String(req.path || "").replace(/\/+$/, "") || "/";
      if (!PENDING_ALLOWED_PATHS.has(subPath)) {
        return next(
          new AppError(
            "This phone is waiting for administrator approval.",
            403,
            "device_pending",
          ),
        );
      }
    }

    req.device = device;
    req.tenantModels = tenantModels;
    req.tenantDbName = tenantDb;

    const now = Date.now();
    const lastSeenMs = device.last_seen_at ? new Date(device.last_seen_at).getTime() : 0;
    if (!lastSeenMs || now - lastSeenMs >= LAST_SEEN_THROTTLE_MS) {
      try {
        await device.update({ last_seen_at: new Date(now) });
      } catch {
        // Heartbeat write is best-effort
      }
    }

    return next();
  } catch (err) {
    // A server fault is not a revoked phone. Answering 401 here made the app wipe its pairing.
    console.error(`deviceAuth error ${req.method} ${String(req.originalUrl || req.url || "").split("?")[0]}:`, err?.message || err);
    return next(new AppError("Could not check this phone right now. Please try again.", 500));
  }
};

export default deviceAuth;
