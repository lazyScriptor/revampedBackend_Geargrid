import * as locker from "../services/cashLockerService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) => initTenantModels(getCachedTenantConnection(req.user.tenantDbName));
const ok = (res, data, code = 200) => res.status(code).json({ status: "success", data });

const actorLabel = async (models, userId) => {
  const u = await models.User.findByPk(userId, { attributes: ["first_name", "last_name", "username"] });
  return u ? [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username : "Staff";
};

// GET /locker/status
export const getStatus = catchAsync(async (req, res) => {
  ok(res, await locker.getStatus(getModels(req)));
});

// POST /locker/opening  { amount, reason? }
export const recordOpening = catchAsync(async (req, res) => {
  const models = getModels(req);
  const { amount, reason } = req.body || {};
  ok(res, await locker.recordOpening(models, { amount, reason, userId: req.user.userId, userLabel: await actorLabel(models, req.user.userId) }), 201);
});

// POST /locker/closing  { counted, sent_home?, reason? }
export const recordClosing = catchAsync(async (req, res) => {
  const models = getModels(req);
  const { counted, sent_home, reason } = req.body || {};
  ok(res, await locker.recordClosing(models, { counted, sent_home, reason, userId: req.user.userId, userLabel: await actorLabel(models, req.user.userId) }), 201);
});

// POST /locker/expenses  { amount, category?, description? }
export const recordExpense = catchAsync(async (req, res) => {
  ok(res, await locker.recordLockerExpense(getModels(req), req.body || {}, req.user.userId), 201);
});

// PATCH /locker/payments/:id/method  { method }
export const changePaymentMethod = catchAsync(async (req, res) => {
  ok(res, await locker.changePaymentMethod(getModels(req), { paymentId: req.params.id, method: req.body?.method, userId: req.user.userId }));
});

// GET /locker/start
export const getStartPreview = catchAsync(async (req, res) => {
  ok(res, await locker.getStartPreview(getModels(req)));
});

// POST /locker/start  { counted, at_home_invoice_ids?, sent_home?, reason? }
export const startLocker = catchAsync(async (req, res) => {
  const { counted, at_home_invoice_ids, sent_home, reason } = req.body || {};
  ok(res, await locker.startLocker(getModels(req), { counted, at_home_invoice_ids, sent_home, reason, userId: req.user.userId }), 201);
});

// GET /locker/history
export const listHistory = catchAsync(async (req, res) => {
  ok(res, await locker.listHistory(getModels(req), { limit: req.query.limit, offset: req.query.offset }));
});

// PATCH /locker/counts/:id/review  { note? }
export const reviewCount = catchAsync(async (req, res) => {
  ok(res, await locker.reviewCount(getModels(req), { countId: req.params.id, note: req.body?.note, userId: req.user.userId }));
});

// PUT /locker/float  { amount }
export const setFloat = catchAsync(async (req, res) => {
  ok(res, await locker.setFloat(getModels(req), req.body?.amount));
});

// PATCH /locker/invoices/:id/advance-at-home  { at_home }
export const setAdvanceAtHome = catchAsync(async (req, res) => {
  ok(res, await locker.setAdvanceAtHome(getModels(req), { invoiceId: req.params.id, atHome: req.body?.at_home }));
});
