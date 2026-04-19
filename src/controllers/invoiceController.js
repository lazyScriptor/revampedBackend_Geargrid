import * as invoiceService from "../services/invoiceService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

// Helper to grab the correct tenant's database models
const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

export const createInvoice = catchAsync(async (req, res, next) => {
  // 1. Extract the payload sent from the React POS
  const { customer_id, items, fees } = req.body;

  // 2. Ensure the user making the request is captured (for the Audit Trace)
  // Assuming your authMiddleware attaches the logged-in user to req.user
  const userId = req.user?.id || 1;

  // 3. Pass to the Service layer to execute the Managed Transaction
  const newInvoice = await invoiceService.createDispatchInvoice(
    getModels(req),
    { customer_id, items, fees },
    userId,
  );

  // 4. Return success
  res.status(201).json({
    status: "success",
    message: "Invoice successfully created and inventory deducted.",
    data: {
      invoice: newInvoice,
    },
  });
});

// We will add getInvoices, updateInvoice, etc., here later when we build the Invoice History table
