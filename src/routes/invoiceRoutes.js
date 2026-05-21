import express from "express";
import * as invoiceController from "../controllers/invoiceController.js";
import * as reviewController from "../controllers/invoiceReviewController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Apply the auth middleware to all invoice routes
router.use(protect);

// 1. Core Invoicing
router.get("/", requirePermission("invoice:view"), invoiceController.getInvoices);
router.post("/", requirePermission("invoice:create"), invoiceController.createInvoice);

// 3. Reviews (per-invoice ratings + comments) — declared before /:id so the
//    "reviews/:reviewId" branch doesn't collide with the detail route.
router.patch("/reviews/:reviewId", requirePermission("invoice:edit"), reviewController.updateReview);
router.delete("/reviews/:reviewId", requirePermission("invoice:edit"), reviewController.deleteReview);

router.get("/:id", requirePermission("invoice:view"), invoiceController.getInvoiceById); // <-- NEW

// 2. OMS Actions
router.post("/:id/return", requirePermission("invoice:action:process_return"), invoiceController.processReturnInvoice);
router.post("/:id/payments", requirePermission("invoice:action:add_payment"), invoiceController.addPayment); // <-- NEW
router.patch("/:id/vault", requirePermission("invoice:edit"), invoiceController.toggleVault); // <-- NEW
router.patch("/:id/fees", requirePermission("invoice:edit"), invoiceController.updateFees);

// 4. Reviews — invoice-scoped list/create
router.get("/:id/reviews", requirePermission("invoice:view"), reviewController.listForInvoice);
router.post("/:id/reviews", requirePermission("invoice:edit"), reviewController.createReview);

export default router;
