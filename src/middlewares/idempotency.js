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

/**
 * Idempotency-Key middleware for mutating routes.
 * - No Idempotency-Key header -> passes through unchanged.
 * - Same key + user + route + same body hash within 24 h -> replays stored response.
 * - Same key + user + route + different body hash within 24 h -> 409 Conflict.
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

    try {
      const existing = await models.IdempotencyKey.findOne({
        where: { key, user_id: userId, route },
      });

      if (existing) {
        const ageMs = now - new Date(existing.created_at).getTime();
        if (ageMs < IDEMPOTENCY_TTL_MS) {
          if (existing.request_hash !== requestHash) {
            return next(
              new AppError(
                "Idempotency-Key was already used with a different request payload.",
                409,
              ),
            );
          }
          const storedBody = parseJsonField(existing.response_body);
          return res.status(existing.response_status).json(storedBody);
        }
        // Expired (> 24h) — remove stale entry so the key can be used again
        await existing.destroy();
      }
    } catch (err) {
      return next(err);
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const status = res.statusCode || 200;
      if (status < 500) {
        Promise.resolve(
          models.IdempotencyKey.create({
            key,
            user_id: userId,
            route,
            request_hash: requestHash,
            response_status: status,
            response_body: body ?? null,
            created_at: new Date(),
          }),
        ).catch(() => {
          // Best-effort persistence; never break the client response
        });
      }
      return originalJson(body);
    };

    return next();
  };
};
