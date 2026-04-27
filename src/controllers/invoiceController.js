import * as invoiceService from "../services/invoiceService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

// Helper to grab the correct tenant's database models
const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

// --- 1. Create a New Dispatch Invoice ---
export const createInvoice = catchAsync(async (req, res, next) => {
  const { customer_id, items, fees } = req.body;
  const userId = req.user?.id || 1;

  const newInvoice = await invoiceService.createDispatchInvoice(
    getModels(req),
    { customer_id, items, fees },
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
  const userId = req.user?.id || 1;

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
  console.log("first")
  const invoice = await invoiceService.getInvoiceById(
    getModels(req),
    req.params.id,
  );
  console.log("This is the invoice",invoice)
  res.status(200).json({
    status: "success",
    data: { invoice },
  });
});

export const addPayment = catchAsync(async (req, res, next) => {
  const userId = req.user?.id || 1;
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
  const userId = req.user?.id || 1;
  const newStatus = await invoiceService.toggleVaultStatus(
    getModels(req),
    req.params.id,
    userId,
  );
  res.status(200).json({
    status: "success",
    message: newStatus
      ? "ID Card logged into vault."
      : "ID Card released from vault.",
    data: { is_id_retained_currently: newStatus },
  });
});
