import * as whatsappService from "../services/whatsappService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) => initTenantModels(getCachedTenantConnection(req.user.tenantDbName));
const ok = (res, data, code = 200) => res.status(code).json({ status: "success", data });

// GET /whatsapp/worklist?language=
export const getWorklist = catchAsync(async (req, res) => {
  ok(res, await whatsappService.getWorklist(getModels(req), { language: req.query.language || undefined }));
});

// POST /whatsapp/compose
export const compose = catchAsync(async (req, res) => {
  const { template_key, invoice_id, customer_id, language, custom_text } = req.body || {};
  ok(res, await whatsappService.composeMessage(getModels(req), { template_key, invoice_id, customer_id, language, custom_text }));
});

// POST /whatsapp/log  — staff opened a chat
export const logMessage = catchAsync(async (req, res) => {
  const { customer_id, invoice_id, template_key, language, to_phone, body } = req.body || {};
  const row = await whatsappService.logMessage(getModels(req), {
    customer_id,
    invoice_id,
    template_key,
    language,
    to_phone,
    body,
    userId: req.user.userId,
  });
  ok(res, { log_id: row.log_id, status: row.status }, 201);
});

// PATCH /whatsapp/log/:id/sent — staff confirm they pressed send
export const confirmSent = catchAsync(async (req, res) => {
  const row = await whatsappService.confirmSent(getModels(req), req.params.id);
  ok(res, { log_id: row.log_id, status: row.status });
});

// GET /whatsapp/log
export const listLog = catchAsync(async (req, res) => {
  const { customer_id, invoice_id, template_key, limit, offset } = req.query;
  ok(res, await whatsappService.listLog(getModels(req), { customer_id, invoice_id, template_key, limit, offset }));
});

// GET /whatsapp/templates
export const getTemplates = catchAsync(async (req, res) => {
  ok(res, await whatsappService.getTemplates(getModels(req)));
});

// PUT /whatsapp/templates/:key/:language
export const saveTemplate = catchAsync(async (req, res) => {
  ok(
    res,
    await whatsappService.saveTemplate(getModels(req), {
      key: req.params.key,
      language: req.params.language,
      body: req.body?.body,
      userId: req.user.userId,
    }),
  );
});

// DELETE /whatsapp/templates/:key/:language  — back to the built-in wording
export const resetTemplate = catchAsync(async (req, res) => {
  ok(res, await whatsappService.resetTemplate(getModels(req), { key: req.params.key, language: req.params.language }));
});

// GET /whatsapp/settings
export const getSettings = catchAsync(async (req, res) => {
  ok(res, await whatsappService.getSettings(getModels(req)));
});

// PUT /whatsapp/settings
export const updateSettings = catchAsync(async (req, res) => {
  const { shop_phone, default_language } = req.body || {};
  ok(res, await whatsappService.updateSettings(getModels(req), { shop_phone, default_language }));
});

// PATCH /whatsapp/customers/:id/opt-out
export const setOptOut = catchAsync(async (req, res) => {
  ok(res, await whatsappService.setOptOut(getModels(req), req.params.id, !!req.body?.opt_out));
});
