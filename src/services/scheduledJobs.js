// Daily jobs that run once for every shop. Wired to cron in utils/cronJobs.js.
import { QueryTypes } from "sequelize";
import { getTenantConnection, masterSequelize } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { purgeExpiredCallLogs, sendDueFollowUpPushes } from "./callLogService.js";

const listTenants = () =>
  masterSequelize.query(
    "SELECT db_name, db_user, encrypted_db_pass, db_host, subscription_status FROM TENANTS",
    { type: QueryTypes.SELECT },
  );

const openModels = async (tenant) =>
  initTenantModels(
    await getTenantConnection(tenant.db_name, tenant.db_user, tenant.encrypted_db_pass, tenant.db_host),
  );

/**
 * Run `job` for each shop, one after another. A shop that fails is logged and the rest still run.
 */
export const forEachTenant = async (
  label,
  job,
  { activeOnly = false, list = listTenants, open = openModels } = {},
) => {
  const results = [];
  for (const tenant of await list()) {
    if (activeOnly && tenant.subscription_status !== "Active") continue;
    try {
      const result = await job(await open(tenant), tenant.db_name);
      results.push({ db_name: tenant.db_name, ok: true, result });
    } catch (error) {
      console.error(`❌ ${label} failed for ${tenant.db_name}:`, error?.message || error);
      results.push({ db_name: tenant.db_name, ok: false });
    }
  }
  return results;
};

/** Follow-up reminders, "Call again today" and promise-to-pay checks. Active shops only. */
export const runFollowUpJob = (options = {}) =>
  forEachTenant(
    "Follow-up job",
    (models, dbName) => sendDueFollowUpPushes(models, dbName, options.now ? { now: options.now } : {}),
    { ...options, activeOnly: true },
  );

/** Deletes call logs and recordings past the shop's keep period, in every shop. */
export const runCallRetentionJob = (options = {}) =>
  forEachTenant(
    "Call retention job",
    (models) => purgeExpiredCallLogs(models, options.now ? { now: options.now } : {}),
    options,
  );
