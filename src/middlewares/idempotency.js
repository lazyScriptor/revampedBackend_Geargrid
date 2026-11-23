import crypto from "node:crypto";
import AppError from "../utils/AppError.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { parseJsonField } from "../utils/jsonFields.js";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const canonicalize = (value) => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        sorted[key] = canonicalize(value[key]);
      }
    }
    return sorted;
  }
  return value;
};

export const hashRequestBody = (body) =>
  crypto.createHash("sha256").update(JSON.stringify(canonicalize(body ?? {}))).digest("hex");

const defaultResolveModels = (req) => {
  if (req.tenantModels) return req.tenantModels;
  if (!req.user?.tenantDbName) return null;
  return initTenantModels(getCachedTenantConnection(req.user.tenantDbName));
};

const isUniqueConstraintError = (err) =>
  err?.name === "SequelizeUniqueConstraintError" ||
  err?.original?.code === "ER_DUP_ENTRY" ||
  err?.parent?.code === "ER_DUP_ENTRY" ||
  err?.code === "ER_DUP_ENTRY";

/**
 * Idempotency-Key middleware for mutating routes.
 * - No Idempotency-Key header -> passes through unchanged.
 * - Reserves key with response_status = 0 BEFORE next() to stop concurrent double-submits.
 * - In-progress (response_status = 0) -> 409 "Request already in progress."
 * - Completed 2xx within 24 h with same body hash -> replays stored response.
 * - Completed within 24 h with different body hash -> 409 Conflict.
 * - Non-2xx response -> deletes reservation so retries can succeed.
 */
export const idempotency = ({ resolveModels = defaultResolveModels } = {}) => {
  return async (req, res, next) => {
    const rawKey = req.get?.("Idempotency-Key") ?? req.headers?.["idempotency-key"];
    if (!rawKey || !String(rawKey).trim()) {
      return next();
    }

    const key = String(rawKey).trim().slice(0, 128);
    const models = resolveModels(req);
    if (!models?.IdempotencyKey) {
      return next();
    }

    const userId = Number(req.user?.userId ?? req.user?.id ?? 0);
    const route = `${req.method} ${req.baseUrl || ""}${req.path || ""}`;
    const requestHash = hashRequestBody(req.body);
    const now = Date.now();

    const reserve = () =>
      models.IdempotencyKey.create({
        key,
        user_id: userId,
        route,
        request_hash: requestHash,
        response_status: 0,
        response_body: null,
        created_at: new Date(now),
      });

    try {
      await reserve();
    } catch (err) {
      if (!isUniqueConstraintError(err)) {
        return next(err);
      }

      try {
        const existing = await models.IdempotencyKey.findOne({
          where: { key, user_id: userId, route },
        });

        if (!existing) {
          // Concurrent request just deleted a failed reservation; try once more
          try {
            await reserve();
          } catch (retryErr) {
            if (isUniqueConstraintError(retryErr)) {
              return next(new AppError("Request already in progress.", 409));
            }
            return next(retryErr);
          }
        } else {
          const ageMs = now - new Date(existing.created_at).getTime();
          if (ageMs >= IDEMPOTENCY_TTL_MS) {
            await existing.destroy();
            try {
              await reserve();
            } catch (retryErr) {
              if (isUniqueConstraintError(retryErr)) {
                return next(new AppError("Request already in progress.", 409));
              }
              return next(retryErr);
            }
          } else if (Number(existing.response_status) === 0) {
            return next(new AppError("Request already in progress.", 409));
          } else if (existing.request_hash !== requestHash) {
            return next(
              new AppError(
                "Idempotency-Key was already used with a different request payload.",
                409,
              ),
            );
          } else {
            const storedBody = parseJsonField(existing.response_body);
            return res.status(existing.response_status).json(storedBody);
          }
        }
      } catch (lookupErr) {
        return next(lookupErr);
      }
    }

    let settled = false;
    const finalize = (status, body) => {
      if (settled) return;
      settled = true;
      if (status >= 200 && status < 300) {
        return Promise.resolve(
          models.IdempotencyKey.update(
            { response_status: status, response_body: body ?? null },
            { where: { key, user_id: userId, route, response_status: 0 } },
          ),
        ).catch(() => {});
      }
      return Promise.resolve(
        models.IdempotencyKey.destroy({
          where: { key, user_id: userId, route, response_status: 0 },
        }),
      ).catch(() => {});
    };

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const status = res.statusCode || 200;
      finalize(status, body);
      return originalJson(body);
    };

    if (typeof res.on === "function") {
      res.on("finish", () => {
        if (!settled) {
          finalize(res.statusCode || 500, null);
        }
      });
    }

    return next();
  };
};
