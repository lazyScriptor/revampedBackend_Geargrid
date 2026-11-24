import * as invoiceService from "../services/invoiceService.js";
import * as invoiceDeletion from "../services/invoiceDeletionService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { returnSaleLines } from "../modules/retail/index.js";
import catchAsync from "../utils/catchAsync.js";

// Helper to grab the correct tenant's database models
const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

// --- 1. Create a New Dispatch Invoice ---
export const createInvoice = catchAsync(async (req, res, next) => {
  const {
    customer_id,
    items,
    fees,
    sale_items,
    job_site,
    customer_po,
    settle_now,
    approval_tokens,
    payment,
    walk_in,
    issued_date,
    borrowed_on_behalf_of_customer_id,
    discount,
    discount_amount,
    warehouse_id,
  } = req.body;
  const userId = req.user.userId;

  const newInvoice = await invoiceService.createDispatchInvoice(
    getModels(req),
    {
      customer_id,
      items,
      fees,
      sale_items,
      job_site,
      customer_po,
      settle_now,
      approval_tokens,
      payment,
      walk_in,
      issued_date,
      borrowed_on_behalf_of_customer_id,
      discount,
      discount_amount,
      warehouse_id,
      effectivePermissions: req.effectivePermissions,
    },
    userId,
  );

  res.status(201).json({
    status: "success",
    message: "Invoice successfully created and inventory deducted.",
    data: {
      invoice: newInvoice,
    },
  });
});

// --- 2. Get All Invoices (For the Rental History Table) ---
export const getInvoices = catchAsync(async (req, res, next) => {
  const result = await invoiceService.getAllInvoices(getModels(req), req.query);
  res.status(200).json({
    status: "success",
    data: result, // returns { totalItems, invoices }
  });
});

// --- 3. Process a Return & Settlement ---
export const processReturnInvoice = catchAsync(async (req, res, next) => {
  const invoice_id = req.params.id;
  const userId = req.user.userId;

  // Combine the URL parameter with the request body payload
  const payload = {
    invoice_id,
    ...req.body,
  };

  await invoiceService.processReturn(getModels(req), payload, userId);

  res.status(200).json({
    status: "success",
    message: "Return processed and inventory updated successfully.",
  });
});

export const getInvoiceById = catchAsync(async (req, res, next) => {
  const invoice = await invoiceService.getInvoiceById(
    getModels(req),
    req.params.id,
  );
  res.status(200).json({
    status: "success",
    data: { invoice },
  });
});

export const addPayment = catchAsync(async (req, res, next) => {
  const userId = req.user.userId;
  const payment = await invoiceService.addContinuousPayment(
    getModels(req),
    req.params.id,
    req.body,
    userId,
  );
  res.status(200).json({
    status: "success",
    message: req.body.is_refund
      ? "Refund processed successfully."
      : "Payment added successfully.",
    data: { payment },
  });
});

export const toggleVault = catchAsync(async (req, res, next) => {
  const userId = req.user.userId;
  const result = await invoiceService.toggleVaultStatus(
    getModels(req),
    req.params.id,
    userId,
  );
  const isRetained = typeof result === "object" ? result.is_id_retained_currently : Boolean(result);
  res.status(200).json({
    status: "success",
    message: isRetained
      ? "ID Card logged into vault."
      : "ID Card released from vault.",
    data: typeof result === "object" ? result : { is_id_retained_currently: isRetained, id_card_status: isRetained ? 1 : 0 },
  });
});
export const updateFees = catchAsync(async (req, res, next) => {
  const userId = req.user.userId;
  const invoice = await invoiceService.updateInvoiceFees(
    getModels(req),
    req.params.id,
    req.body,
    userId,
  );
  res.status(200).json({
    status: "success",
    message: "Invoice fees updated successfully.",
    data: { invoice },
  });
});

// --- Soft delete / restore / deleted-invoices report ---
const actorOf = (req) => ({ userId: req.user.userId, permissions: req.effectivePermissions });

export const deleteInvoice = catchAsync(async (req, res) => {
  const data = await invoiceDeletion.deleteInvoice(getModels(req), Number(req.params.id), actorOf(req), req.body || {});
  res.status(200).json({ status: "success", message: "Invoice deleted.", data });
});

export const restoreInvoice = catchAsync(async (req, res) => {
  const data = await invoiceDeletion.restoreInvoice(getModels(req), Number(req.params.id), actorOf(req));
  res.status(200).json({ status: "success", message: "Invoice restored.", data });
});

export const getDeletedInvoices = catchAsync(async (req, res) => {
  const data = await invoiceDeletion.listDeletedInvoices(getModels(req), req.query);
  res.status(200).json({ status: "success", data });
});

// POST /invoices/:id/sale-returns — return sold items (retail). Refund now or keep as credit.
export const returnSaleItems = catchAsync(async (req, res) => {
  const models = getModels(req);
  const { lines, settlement, reason, approval_tokens } = req.body || {};
  const result = await returnSaleLines(models, Number(req.params.id), {
    lines,
    settlement,
    reason,
    approval_tokens,
    userId: req.user.userId,
    effectivePermissions: req.effectivePermissions,
  });
  const invoice = await invoiceService.getInvoiceById(models, Number(req.params.id));
  res.status(200).json({
    status: "success",
    message: "Return recorded.",
    data: { invoice, settlement: result.settlement, returned_value: result.returned_value, balance: result.balance },
  });
});

// POST /invoices/:id/complete
export const completeInvoice = catchAsync(async (req, res) => {
  const invoice = await invoiceService.completeInvoice(getModels(req), req.params.id, req.body || {}, req.user.userId);
  res.status(200).json({ status: "success", message: "Invoice completed.", data: { invoice } });
});

// POST /invoices/:id/reopen
export const reopenInvoice = catchAsync(async (req, res) => {
  const invoice = await invoiceService.reopenInvoice(getModels(req), req.params.id, req.user.userId);
  res.status(200).json({ status: "success", message: "Invoice reopened.", data: { invoice } });
});
