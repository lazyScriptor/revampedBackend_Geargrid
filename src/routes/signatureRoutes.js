import express from "express";
import {
  GetSignatureSessionContract,
  SubmitSignatureContract,
  CancelSignatureRequestContract,
} from "@geargrid/contracts";
import * as signatureService from "../services/signatureService.js";
import { protect } from "../middlewares/authMiddleware.js";
import { registerContract } from "../utils/contractAdapter.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import AppError from "../utils/AppError.js";

const router = express.Router();

const resolveTenantModels = (req) =>
  initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

// ─────────────────────────────────────────────────────────────────────────
// Public endpoints — token IS the authorization. No `protect` middleware.
// The signature session row holds the invoice_id + requester, and the token
// is single-session scoped; a leaked token at worst lets someone submit a
// signature on an invoice they'd be at the counter for anyway. Low attack
// value, matches the "security is not the primary concern — latency is" call.
// ─────────────────────────────────────────────────────────────────────────

// We need to resolve the tenant from the token alone (no JWT). The token is
// unique across tenant DBs by probability (24 random bytes). Strategy:
// iterate active tenants, find the one whose SIGNATURE_REQUESTS table has
// the token. Cached per-token for the TTL window would be a nice later
// optimisation; for now the lookup is O(active tenants).
const resolveTenantModelsFromToken = async (token) => {
  const { getMasterModels } = await import("../models/master/index.js");
  const masterModels = getMasterModels();
  const tenants = await masterModels.Tenant.findAll({
    where: { subscription_status: "Active" },
    attributes: ["db_name"],
  });
  for (const tenant of tenants) {
    try {
      const connection = getCachedTenantConnection(tenant.db_name);
      const models = initTenantModels(connection);
      const row = await models.SignatureRequest.findOne({
        where: { token },
        attributes: ["request_id"],
      });
      if (row) return { models, tenantDbName: tenant.db_name };
    } catch {
      // Tenant DB offline / unreachable — skip and continue.
    }
  }
  throw new AppError("Signature session not found", 404);
};

registerContract(router, GetSignatureSessionContract, {
  basePath: "/signatures",
  handler: async ({ params }) => {
    const { models } = await resolveTenantModelsFromToken(params.token);
    return signatureService.getPublicSignatureSession(models, params.token);
  },
});

registerContract(router, SubmitSignatureContract, {
  basePath: "/signatures",
  handler: async ({ params, body, req }) => {
    const { models, tenantDbName } = await resolveTenantModelsFromToken(
      params.token,
    );
    return signatureService.submitSignature(models, params.token, body, {
      ip:
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        null,
      userAgent: req.headers["user-agent"] || null,
      tenantDbName,
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Authenticated endpoint — operator cancels a pending session.
// ─────────────────────────────────────────────────────────────────────────
router.delete(
  "/requests/:token",
  protect,
  async (req, res, next) => {
    try {
      const parsed = CancelSignatureRequestContract.params.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError("Invalid token.", 400);
      }
      const result = await signatureService.cancelSignatureRequest(
        resolveTenantModels(req),
        parsed.data.token,
        req.user,
        { tenantDbName: req.user.tenantDbName },
      );
      res.json({ status: "success", data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
