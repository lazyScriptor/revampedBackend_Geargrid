import * as bulkJobService from "../services/bulkJobService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/AppError.js";
import { saveInputFile, streamFile, fileSize } from "../utils/jobFileStore.js";
import path from "path";
import fs from "fs";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

const EXPORT_OPERATIONS = {
  equipment: {
    xlsx: "export_equipment_excel",
    csv: "export_equipment_csv",
  },
  customers: {
    xlsx: "export_customers_excel",
    csv: "export_customers_csv",
  },
  invoices: {
    xlsx: "export_invoices_excel",
  },
};

const IMPORT_OPERATIONS = {
  equipment: "import_equipment",
  customers: "import_customers",
};

export const listJobs = catchAsync(async (req, res) => {
  const result = await bulkJobService.listJobs(
    getModels(req),
    req.user.userId,
    {
      status: req.query.status,
      entity: req.query.entity,
      mode: req.query.mode,
      page: req.query.page,
      limit: req.query.limit,
      onlyMine: req.query.onlyMine !== "false",
    },
  );
  res.status(200).json({ status: "success", data: result });
});

export const getJob = catchAsync(async (req, res) => {
  const job = await bulkJobService.getJob(
    getModels(req),
    req.params.id,
    req.user.userId,
  );
  res.status(200).json({ status: "success", data: { job } });
});

export const cancelJob = catchAsync(async (req, res) => {
  const job = await bulkJobService.cancelJob(
    getModels(req),
    req.params.id,
    req.user.userId,
  );
  res.status(200).json({ status: "success", data: { job } });
});

export const createExportJob = catchAsync(async (req, res, next) => {
  const { entity } = req.params;
  const format = (req.body?.format || req.query?.format || "xlsx").toLowerCase();
  const map = EXPORT_OPERATIONS[entity];
  if (!map) return next(new AppError(`Exports not available for "${entity}".`, 400));
  const operation = map[format];
  if (!operation) {
    return next(new AppError(`Format "${format}" not supported for ${entity}.`, 400));
  }

  const job = await bulkJobService.createJob(getModels(req), {
    userId: req.user.userId,
    operation,
    entity,
    mode: "export",
    params: req.body?.filters || {},
  });

  res.status(202).json({ status: "success", data: { job } });
});

export const createImportJob = catchAsync(async (req, res, next) => {
  const { entity } = req.params;
  const operation = IMPORT_OPERATIONS[entity];
  if (!operation) return next(new AppError(`Imports not available for "${entity}".`, 400));
  if (!req.file) return next(new AppError("No file uploaded.", 400));

  // Create the job row first so we have an ID to namespace the file with.
  const created = await bulkJobService.createJob(getModels(req), {
    userId: req.user.userId,
    operation,
    entity,
    mode: "import",
    params: { original_filename: req.file.originalname },
  });

  // Persist the input file under uploads/jobs/<tenant>/<jobId>/
  const inputFilePath = saveInputFile(
    req.user.tenantDbName,
    created.job_id,
    req.file.originalname,
    req.file.buffer,
  );

  // Patch the job row with the file path so the worker can find it.
  const models = getModels(req);
  await models.BulkJob.update(
    { input_file_path: inputFilePath },
    { where: { job_id: created.job_id } },
  );

  res.status(202).json({
    status: "success",
    data: { job: { ...created, input_file_path: inputFilePath } },
  });
});

export const downloadJobOutput = catchAsync(async (req, res, next) => {
  const job = await bulkJobService.getJob(
    getModels(req),
    req.params.id,
    req.user.userId,
  );
  if (!job.output_file_path) {
    return next(new AppError("This job has no downloadable file.", 404));
  }
  const stream = streamFile(job.output_file_path);
  if (!stream) return next(new AppError("File missing on disk.", 410));

  const fileName = path.basename(job.output_file_path).replace(/^output_/, "");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Content-Length", String(fileSize(job.output_file_path)));
  stream.pipe(res);
});

export const listDownloads = catchAsync(async (req, res) => {
  // Convenience endpoint for the Downloads section of Data Arena: every
  // completed export/dry-run job whose output file still exists on disk.
  const models = getModels(req);
  const { jobs } = await bulkJobService.listJobs(models, req.user.userId, {
    page: 1,
    limit: 100,
  });
  const downloads = jobs
    .filter(
      (j) =>
        ["completed", "awaiting_confirmation"].includes(j.status) &&
        j.output_file_path &&
        fs.existsSync(j.output_file_path),
    )
    .map((j) => ({
      job_id: j.job_id,
      operation: j.operation,
      entity: j.entity,
      file_size_bytes: fileSize(j.output_file_path),
      created_at: j.createdAt,
      finished_at: j.finished_at,
      download_url: `/api/bulk-jobs/${j.job_id}/download`,
    }));
  res.status(200).json({ status: "success", data: { downloads } });
});
