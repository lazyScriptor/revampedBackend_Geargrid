import * as reviewService from "../services/invoiceReviewService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

export const listForInvoice = catchAsync(async (req, res) => {
  const reviews = await reviewService.listForInvoice(getModels(req), req.params.id);
  res.status(200).json({ status: "success", data: { reviews } });
});

export const createReview = catchAsync(async (req, res) => {
  const review = await reviewService.create(
    getModels(req),
    req.params.id,
    req.body,
    req.user.userId,
  );
  res.status(201).json({ status: "success", data: { review } });
});

export const updateReview = catchAsync(async (req, res) => {
  const review = await reviewService.update(
    getModels(req),
    req.params.reviewId,
    req.body,
    req.user.userId,
  );
  res.status(200).json({ status: "success", data: { review } });
});

export const deleteReview = catchAsync(async (req, res) => {
  await reviewService.remove(getModels(req), req.params.reviewId, req.user.userId);
  res.status(200).json({ status: "success", message: "Review deleted." });
});
