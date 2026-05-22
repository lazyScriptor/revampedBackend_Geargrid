import { Op } from "sequelize";
import { emitToUser } from "../sockets/emitters.js";
import AppError from "../utils/AppError.js";

const sanitize = (row) => (row && typeof row.toJSON === "function" ? row.toJSON() : row);

export const createJob = async (
  models,
  { userId, operation, entity = null, mode = "export", params = null, inputFilePath = null },
) => {
  const job = await models.BulkJob.create({
    user_id: userId,
    operation,
    entity,
    mode,
    status: "queued",
    progress: 0,
    params,
    input_file_path: inputFilePath,
  });
  return sanitize(job);
};

export const listJobs = async (
  models,
  userId,
  {
    status = null,
    entity = null,
    mode = null,
    page = 1,
    limit = 25,
    onlyMine = true,
  } = {},
) => {
  const where = {};
  if (onlyMine) where.user_id = userId;
  if (status) where.status = status;
  if (entity) where.entity = entity;
  if (mode) where.mode = mode;

  const safeLimit = Math.min(Number(limit) || 25, 100);
  const offset = (Math.max(1, Number(page) || 1) - 1) * safeLimit;

  const { rows, count } = await models.BulkJob.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    limit: safeLimit,
    offset,
  });

  return {
    jobs: rows.map(sanitize),
    total: count,
    page: Math.max(1, Number(page) || 1),
    limit: safeLimit,
  };
};

export const getJob = async (models, jobId, userId, { allowAny = false } = {}) => {
  const where = { job_id: jobId };
  if (!allowAny) where.user_id = userId;
  const row = await models.BulkJob.findOne({ where });
  if (!row) throw new AppError("Job not found.", 404);
  return sanitize(row);
};

export const cancelJob = async (models, jobId, userId) => {
  const row = await models.BulkJob.findOne({
    where: { job_id: jobId, user_id: userId },
  });
  if (!row) throw new AppError("Job not found.", 404);
  if (["completed", "failed", "cancelled"].includes(row.status)) {
    throw new AppError(`Job already ${row.status}.`, 400);
  }
  row.status = "cancelled";
  row.finished_at = new Date();
  await row.save();
  emitToUser(userId, "bulkJob:update", sanitize(row));
  return sanitize(row);
};

// ───────────────────────────────────────────────────────────────
// Worker-side helpers
// ───────────────────────────────────────────────────────────────

export const claimNextQueuedJobs = async (models, { limit = 2 } = {}) => {
  // We don't have a queue, so a tiny "claim" pattern: read N queued, flip
  // their status to processing in one update keyed by job_id list.
  const queued = await models.BulkJob.findAll({
    where: { status: "queued" },
    order: [["createdAt", "ASC"]],
    limit,
  });
  if (queued.length === 0) return [];

  const ids = queued.map((j) => j.job_id);
  const now = new Date();
  await models.BulkJob.update(
    { status: "processing", started_at: now },
    { where: { job_id: { [Op.in]: ids }, status: "queued" } },
  );

  // Reload to get fresh state
  const claimed = await models.BulkJob.findAll({
    where: { job_id: { [Op.in]: ids }, status: "processing" },
  });
  return claimed.map(sanitize);
};

export const updateProgress = async (
  models,
  jobId,
  { progress, processedCount, totalCount, errorCount },
) => {
  const updates = {};
  if (progress != null) updates.progress = Math.max(0, Math.min(100, progress));
  if (processedCount != null) updates.processed_count = processedCount;
  if (totalCount != null) updates.total_count = totalCount;
  if (errorCount != null) updates.error_count = errorCount;
  await models.BulkJob.update(updates, { where: { job_id: jobId } });
};

export const completeJob = async (
  models,
  jobId,
  { resultPayload = null, outputFilePath = null } = {},
) => {
  const row = await models.BulkJob.findByPk(jobId);
  if (!row) return null;
  row.status = "completed";
  row.progress = 100;
  row.finished_at = new Date();
  if (resultPayload) row.result_payload = resultPayload;
  if (outputFilePath) row.output_file_path = outputFilePath;
  await row.save();
  emitToUser(row.user_id, "bulkJob:complete", sanitize(row));
  return sanitize(row);
};

export const failJob = async (models, jobId, errorMessage) => {
  const row = await models.BulkJob.findByPk(jobId);
  if (!row) return null;
  row.status = "failed";
  row.error_message = errorMessage || "Unknown error";
  row.finished_at = new Date();
  await row.save();
  emitToUser(row.user_id, "bulkJob:complete", sanitize(row));
  return sanitize(row);
};

export const markAwaitingConfirmation = async (
  models,
  jobId,
  { resultPayload = null, outputFilePath = null } = {},
) => {
  const row = await models.BulkJob.findByPk(jobId);
  if (!row) return null;
  row.status = "awaiting_confirmation";
  row.progress = 100;
  if (resultPayload) row.result_payload = resultPayload;
  if (outputFilePath) row.output_file_path = outputFilePath;
  await row.save();
  emitToUser(row.user_id, "bulkJob:update", sanitize(row));
  return sanitize(row);
};
