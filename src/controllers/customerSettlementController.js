import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import * as settlementService from "../services/customerSettlementService.js";
import { SettlementChangedError } from "../services/customerSettlementService.js";

const resolveModels = (req) =>
  req.tenantModels || initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

export const getOverview = async (req, res, next) => {
  try {
    const models = resolveModels(req);
    const data = await settlementService.getSettlementOverview(models, req.params.id);
    res.status(200).json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

export const getOpenBills = async (req, res, next) => {
  try {
    const models = resolveModels(req);
    const data = await settlementService.getCustomerOpenBills(models, req.params.id, req.query);
    res.status(200).json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

export const preview = async (req, res, next) => {
  try {
    const models = resolveModels(req);
    const userId = req.user?.id || req.user?.user_id || null;
    const data = await settlementService.previewSettlement(models, req.params.id, req.body, {
      userId,
    });
    res.status(200).json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

export const save = async (req, res, next) => {
  try {
    const models = resolveModels(req);
    const userId = req.user?.id || req.user?.user_id || 1;
    const idempotencyKey = req.get("Idempotency-Key") || req.body?.idempotency_key || null;
    const data = await settlementService.saveSettlement(
      models,
      req.params.id,
      { ...req.body, idempotency_key: idempotencyKey },
      userId,
    );
    res.status(201).json({ status: "success", data });
  } catch (err) {
    if (err instanceof SettlementChangedError) {
      return res.status(409).json({
        status: "fail",
        code: "settlement_changed",
        message: err.message,
        data: {
          code: "settlement_changed",
          preview: err.preview,
        },
      });
    }
    next(err);
  }
};

export const completeBills = async (req, res, next) => {
  try {
    const models = resolveModels(req);
    const userId = req.user?.id || req.user?.user_id || 1;
    const data = await settlementService.completeSettlementBills(
      models,
      req.params.id,
      req.body,
      userId,
    );
    res.status(200).json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

export const voidSettlement = async (req, res, next) => {
  try {
    const models = resolveModels(req);
    const userId = req.user?.id || req.user?.user_id || 1;
    const data = await settlementService.voidSettlement(models, req.params.id, userId, {
      reason: req.body?.reason || null,
    });
    res.status(200).json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

export const getSettlement = async (req, res, next) => {
  try {
    const models = resolveModels(req);
    const data = await settlementService.getSettlementById(models, req.params.id);
    res.status(200).json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};
