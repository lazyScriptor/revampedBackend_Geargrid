import express from "express";
import * as invoiceController from "../controllers/invoiceController.js";
import * as reviewController from "../controllers/invoiceReviewController.js";
import * as printLogController from "../controllers/invoicePrintLogController.js";
import * as invoiceService from "../services/invoiceService.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";
import { registerContract } from "../utils/contractAdapter.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import {
  VaultToggleContract,
  CreateSignatureRequestContract,
  ListInvoiceSignaturesContract,
} from "@geargrid/contracts";
import * as signatureService from "../services/signatureService.js";

const router = express.Router();

const resolveTenantModels = (req) =>
  initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

// Apply the auth middleware to all invoice routes
router.use(protect);

// 1. Core Invoicing
router.get("/", requirePermission("invoice:view"), invoiceController.getInvoices);
router.post("/", requirePermission("invoice:create"), invoiceController.createInvoice);

// 2. Bill Printing Audit Logs — declared before /:id so /print-logs doesn't collide with /:id
router.post("/print-logs", printLogController.createPrintLog);
router.get("/print-logs", requirePermission("invoice:print_log:view"), printLogController.getPrintLogs);
router.get("/print-logs/:logId", requirePermission("invoice:print_log:view"), printLogController.getPrintLogDetails);

// 3. Reviews (per-invoice ratings + comments) — declared before /:id so the
//    "reviews/:reviewId" branch doesn't collide with the detail route.
router.patch("/reviews/:reviewId", requirePermission("invoice:edit"), reviewController.updateReview);
router.delete("/reviews/:reviewId", requirePermission("invoice:edit"), reviewController.deleteReview);

// Deleted-invoices report + delete/restore (MUST be before /:id)
router.get("/deleted", requirePermission("invoice:restore", "invoice:delete:any"), invoiceController.getDeletedInvoices);
router.delete("/:id", requirePermission("invoice:delete", "invoice:delete:any"), invoiceController.deleteInvoice);
router.post("/:id/restore", requirePermission("invoice:restore"), invoiceController.restoreInvoice);

router.get("/:id", requirePermission("invoice:view"), invoiceController.getInvoiceById); // <-- NEW
router.get("/:id/print-logs", requirePermission("invoice:print_log:view"), printLogController.getInvoicePrintLogs);

// 2. OMS Actions
router.post("/:id/return", requirePermission("invoice:action:process_return"), invoiceController.processReturnInvoice);
router.post("/:id/payments", requirePermission("invoice:action:add_payment"), invoiceController.addPayment); // <-- NEW
router.post("/:id/complete", requirePermission("invoice:action:process_return"), invoiceController.completeInvoice);
router.post("/:id/reopen", requirePermission("invoice:edit"), invoiceController.reopenInvoice);
// Governed by @geargrid/contracts: VaultToggleContract.
// Request/response shape, path, and method all live in shared/geargrid-contracts
// and are vendored into revampedBackend_Geargrid/vendor/@geargrid/contracts/.
registerContract(router, VaultToggleContract, {
  basePath: "/invoices",
  middlewares: [requirePermission("invoice:edit")],
  handler: async ({ params, req }) => {
    const userId = req.user?.id || 1;
    return invoiceService.toggleVaultStatus(resolveTenantModels(req), params.id, userId);
  },
});
router.patch("/:id/fees", requirePermission("invoice:edit"), invoiceController.updateFees);

// 4. Reviews — invoice-scoped list/create
router.get("/:id/reviews", requirePermission("invoice:view"), reviewController.listForInvoice);
router.post("/:id/reviews", requirePermission("invoice:edit"), reviewController.createReview);

// 5. Signatures — create capture session + list captured signatures.
//    Public endpoints for the mobile sign page live under /api/signatures/*
//    in signatureRoutes.js. Contract-governed via @geargrid/contracts.
registerContract(router, CreateSignatureRequestContract, {
  basePath: "/invoices",
  middlewares: [requirePermission("invoice:signature:request")],
  handler: ({ params, body, req }) =>
    signatureService.createSignatureRequest(
      resolveTenantModels(req),
      req.user,
      params.id,
      body,
    ),
});

registerContract(router, ListInvoiceSignaturesContract, {
  basePath: "/invoices",
  middlewares: [requirePermission("invoice:signature:view")],
  handler: ({ params, req }) =>
    signatureService.listInvoiceSignatures(resolveTenantModels(req), params.id),
});

export default router;
