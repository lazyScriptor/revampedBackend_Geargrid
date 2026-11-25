import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { parseJsonField } from "../utils/jsonFields.js";

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Idempotency middleware for mutating endpoints.
 * - Reads `Idempotency-Key` header.
 * - Reserves the key first (`status = 'processing'`).
 * - Concurrent duplicate while still processing -> 409.
 * - Completed key within 24h -> replays stored 2xx response.
 * - Only 2xx responses are stored; non-2xx releases the reservation.
 */
export const settlementIdempotency = ({
  scope = (req) => `${req.method}:${req.baseUrl}${req.route?.path || req.path}`,
  resolveModels = (req) =>
    req.tenantModels ||
    (req.user?.tenantDbName
      ? initTenantModels(getCachedTenantConnection(req.user.tenantDbName))
      : null),
} = {}) => {
  return async (req, res, next) => {
    const rawKey = req.get("Idempotency-Key");
    const key = rawKey ? String(rawKey).trim() : "";
    if (!key) return next();

    if (key.length > 128) {
      return res.status(400).json({
        status: "fail",
        message: "Idempotency-Key header must be 128 characters or fewer.",
      });
    }

    const models = resolveModels(req);
    if (!models?.SettlementIdempotencyKey) return next();

    const scopeStr = String(typeof scope === "function" ? scope(req) : scope).slice(0, 120);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL_MS);

    let record = null;
    try {
      record = await models.SettlementIdempotencyKey.create({
        scope: scopeStr,
        idempotency_key: key,
        status: "processing",
        created_at: now,
        expires_at: expiresAt,
      });
    } catch (err) {
      const isUnique =
        err?.name === "SequelizeUniqueConstraintError" ||
        err?.original?.code === "ER_DUP_ENTRY" ||
        err?.parent?.code === "ER_DUP_ENTRY";
      if (!isUnique) return next(err);

      const existing = await models.SettlementIdempotencyKey.findOne({
        where: { scope: scopeStr, idempotency_key: key },
      });

      if (!existing) {
        return res.status(409).json({
          status: "fail",
          code: "idempotency_in_progress",
          message: "Request with this Idempotency-Key is already in progress.",
        });
      }

      if (existing.expires_at && new Date(existing.expires_at).getTime() <= now.getTime()) {
        // Expired: reclaim
        await existing.update({
          status: "processing",
          response_status: null,
          response_body: null,
          created_at: now,
          expires_at: expiresAt,
        });
        record = existing;
      } else if (existing.status === "processing") {
        return res.status(409).json({
          status: "fail",
          code: "idempotency_in_progress",
          message: "Request with this Idempotency-Key is already in progress.",
        });
      } else {
        const storedBody = parseJsonField(existing.response_body, existing.response_body);
        return res.status(existing.response_status || 200).json(storedBody);
      }
    }

    let finalized = false;
    const finalize = async (statusCode, body) => {
      if (finalized) return;
      finalized = true;
      try {
        if (statusCode >= 200 && statusCode < 300) {
          await record.update({
            status: "completed",
            response_status: statusCode,
            response_body: body ?? null,
          });
        } else {
          await record.destroy();
        }
      } catch {
        // Best-effort cleanup
      }
    };

    const origJson = res.json.bind(res);
    res.json = (body) => {
      void finalize(res.statusCode, body);
      return origJson(body);
    };

    res.on("close", () => {
      if (!finalized) {
        void finalize(res.statusCode >= 200 && res.statusCode < 300 ? res.statusCode : 500, null);
      }
    });

    return next();
  };
};
