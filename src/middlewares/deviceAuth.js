import crypto from "node:crypto";
import AppError from "../utils/AppError.js";
import { STATUS_CACHE_TTL, tenantStatusCache } from "../utils/tenantStatusCache.js";
import { isPaymentLocked } from "../config/paymentNotice.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { getMasterModels } from "../models/master/index.js";

const LAST_SEEN_THROTTLE_MS = 60_000;
const PAIR_AGAIN_MSG = "Device authentication failed. Please pair this phone again.";

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

const safeTimingEqualHex = (rawToken, expectedHashHex) => {
  if (!rawToken || !expectedHashHex || typeof expectedHashHex !== "string") return false;
  if (!/^[a-f0-9]{64}$/i.test(expectedHashHex)) return false;

  const presentedHex = crypto.createHash("sha256").update(String(rawToken)).digest("hex");
  const a = Buffer.from(presentedHex.toLowerCase(), "utf8");
  const b = Buffer.from(expectedHashHex.toLowerCase(), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
      return next(new AppError(PAIR_AGAIN_MSG, 401));
    }

    const tenantInfo = await getActiveTenantStatus(tenantDb);
    if (!tenantInfo || tenantInfo.status !== "Active") {
      return next(new AppError(PAIR_AGAIN_MSG, 401));
    }
    if (isPaymentLocked(tenantInfo.status, tenantInfo.paymentNotice, Date.now())) {
      return next(new AppError("Subscription payment is overdue. Please settle your account.", 403));
    }

    const tenantConnection = getCachedTenantConnection(tenantDb);
    const tenantModels = initTenantModels(tenantConnection);
    const device = await tenantModels.OperatorDevice.findOne({ where: { device_id: deviceId } });

    if (!device || !safeTimingEqualHex(token, device.token_hash)) {
      return next(new AppError(PAIR_AGAIN_MSG, 401));
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
  } catch {
    return next(new AppError(PAIR_AGAIN_MSG, 401));
  }
};

export default deviceAuth;
