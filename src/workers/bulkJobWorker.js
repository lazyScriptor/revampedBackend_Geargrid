import { masterSequelize } from "../config/database.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { QueryTypes } from "sequelize";
import {
  claimNextQueuedJobs,
  updateProgress,
  completeJob,
  failJob,
  markAwaitingConfirmation,
} from "../services/bulkJobService.js";
import { createNotification } from "../services/notificationService.js";
import { handlers } from "./handlers/index.js";

const POLL_INTERVAL_MS = 2000;
const MAX_CONCURRENT_JOBS = 2;

let pollTimer = null;
let inflight = 0;
let isRunning = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getTenantList = async () => {
  // Read tenant db_names from master DB. This is the same query the server
  // bootstrap uses to pre-cache tenant connections.
  const rows = await masterSequelize.query(
    "SELECT db_name FROM TENANTS",
    { type: QueryTypes.SELECT },
  );
  return rows.map((r) => r.db_name);
};

const runJob = async (tenantDbName, models, job) => {
  const handler = handlers[job.operation];
  if (!handler) {
    await failJob(models, job.job_id, `No handler registered for operation "${job.operation}"`);
    await createNotification(models, {
      userId: job.user_id,
      type: "error",
      category: "data_arena",
      title: "Bulk job failed",
      message: `Unknown operation: ${job.operation}`,
      payload: { job_id: job.job_id },
      link: `/data-arena?section=jobs&id=${job.job_id}`,
    });
    return;
  }

  const ctx = {
    tenantDbName,
    models,
    job,
    reportProgress: async ({ progress, processedCount, totalCount, errorCount }) => {
      await updateProgress(models, job.job_id, {
        progress,
        processedCount,
        totalCount,
        errorCount,
      });
    },
  };

  try {
    const result = await handler(ctx);
    // Handlers may return:
    //   { status: "completed", resultPayload, outputFilePath }
    //   { status: "awaiting_confirmation", resultPayload, outputFilePath }   (dry-runs)
    //   anything else → treated as completed with no result
    const finalStatus = result?.status || "completed";

    if (finalStatus === "awaiting_confirmation") {
      await markAwaitingConfirmation(models, job.job_id, {
        resultPayload: result.resultPayload || null,
        outputFilePath: result.outputFilePath || null,
      });
      await createNotification(models, {
        userId: job.user_id,
        type: "warning",
        category: "data_arena",
        title: "Dry-run ready for review",
        message: `${job.operation} produced a preview. Confirm to commit changes.`,
        payload: { job_id: job.job_id },
        link: `/data-arena?section=jobs&id=${job.job_id}`,
      });
    } else {
      await completeJob(models, job.job_id, {
        resultPayload: result?.resultPayload || null,
        outputFilePath: result?.outputFilePath || null,
      });
      await createNotification(models, {
        userId: job.user_id,
        type: "success",
        category: "data_arena",
        title: titleForJob(job, true),
        message: result?.summary || `${job.operation} completed.`,
        payload: { job_id: job.job_id },
        link: `/data-arena?section=jobs&id=${job.job_id}`,
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Bulk job ${job.job_id} (${job.operation}) failed:`, err);
    await failJob(models, job.job_id, err.message || "Unhandled error");
    await createNotification(models, {
      userId: job.user_id,
      type: "error",
      category: "data_arena",
      title: titleForJob(job, false),
      message: err.message || "Job failed unexpectedly.",
      payload: { job_id: job.job_id },
      link: `/data-arena?section=jobs&id=${job.job_id}`,
    });
  }
};

const titleForJob = (job, success) => {
  const op = job.operation.replace(/_/g, " ");
  return success ? `${op} completed` : `${op} failed`;
};

const tickOnce = async () => {
  if (inflight >= MAX_CONCURRENT_JOBS) return;

  const tenants = await getTenantList();

  for (const tenantDbName of tenants) {
    if (inflight >= MAX_CONCURRENT_JOBS) break;

    let connection;
    try {
      connection = getCachedTenantConnection(tenantDbName);
    } catch {
      // Tenant connection was lost — skip; will retry on next tick.
      continue;
    }
    const models = initTenantModels(connection);

    const slots = MAX_CONCURRENT_JOBS - inflight;
    const claimed = await claimNextQueuedJobs(models, { limit: slots });
    for (const job of claimed) {
      inflight += 1;
      // Don't await — run concurrently inside the cap.
      runJob(tenantDbName, models, job).finally(() => {
        inflight -= 1;
      });
    }
  }
};

const loop = async () => {
  if (!isRunning) return;
  try {
    await tickOnce();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("bulkJobWorker tick error:", err.message);
  }
  pollTimer = setTimeout(loop, POLL_INTERVAL_MS);
};

export const startBulkJobWorker = () => {
  if (isRunning) return;
  isRunning = true;
  // eslint-disable-next-line no-console
  console.log(
    `⚙️  Bulk job worker started (poll=${POLL_INTERVAL_MS}ms, concurrency=${MAX_CONCURRENT_JOBS}).`,
  );
  loop();
};

export const stopBulkJobWorker = async () => {
  isRunning = false;
  if (pollTimer) clearTimeout(pollTimer);
  // Best-effort: wait briefly for any in-flight jobs to wind down.
  for (let i = 0; i < 10 && inflight > 0; i++) {
    await sleep(200);
  }
};
