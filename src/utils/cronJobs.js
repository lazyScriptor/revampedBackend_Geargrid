import cron from "node-cron";
import { getTenantConnection, masterSequelize } from "../config/database.js";
import { Op } from "sequelize";
import { initMasterModels } from "../models/master/index.js";
import { initTenantModels } from "../models/index.js";
import { getTenantPlan } from "../services/planService.js";
import { checkStockIntegrity } from "../modules/retail/index.js";

export const runNightlyStockIntegrityCheck = async () => {
  const { Tenant } = initMasterModels(masterSequelize);
  const tenants = await Tenant.findAll({
    where: { subscription_status: { [Op.ne]: "Suspended" } },
    attributes: ["db_name", "db_user", "encrypted_db_pass", "db_host"],
  });

  const results = [];
  for (const t of tenants) {
    try {
      const plan = await getTenantPlan(t.db_name);
      if (!plan || plan.features?.retail !== true) continue;

      const conn = await getTenantConnection(
        t.db_name,
        t.db_user,
        t.encrypted_db_pass,
        t.db_host,
      );
      const models = initTenantModels(conn);
      const report = await checkStockIntegrity(models);
      results.push({ db_name: t.db_name, ...report });

      if (!report.ok && models.Notification?.create) {
        const admins = await models.User.findAll({
          where: { is_active: true },
          include: [
            {
              model: models.Role,
              where: { hierarchy_level: { [Op.gte]: 100 } },
              attributes: ["role_id"],
            },
          ],
          attributes: ["user_id"],
        });
        for (const admin of admins || []) {
          await models.Notification.create({
            user_id: admin.user_id,
            type: "warning",
            category: "retail_integrity",
            title: "Retail stock integrity mismatch detected",
            message: `${report.mismatches.length} product/location pair(s) do not match movement history.`,
            payload: { mismatches: report.mismatches.slice(0, 20) },
          });
        }
      }
    } catch {
      // Skip tenants not yet migrated or unreachable
    }
  }
  return results;
};

export const cleanupExpiredIdempotencyKeys = async () => {
  const { Tenant } = initMasterModels(masterSequelize);
  const tenants = await Tenant.findAll({
    where: { subscription_status: { [Op.ne]: "Suspended" } },
    attributes: ["db_name", "db_user", "encrypted_db_pass", "db_host"],
  });
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let totalDeleted = 0;
  for (const t of tenants) {
    try {
      const conn = await getTenantConnection(
        t.db_name,
        t.db_user,
        t.encrypted_db_pass,
        t.db_host,
      );
      const { IdempotencyKey } = initTenantModels(conn);
      const deleted = await IdempotencyKey.destroy({
        where: { created_at: { [Op.lt]: cutoff } },
      });
      totalDeleted += deleted;
    } catch {
      // Skip tenants whose DB isn't migrated yet
    }
  }
  return totalDeleted;
};

const setupCronJobs = () => {
  // Run everyday at midnight (0 0 * * *)
  cron.schedule("0 0 * * *", async () => {
    console.log("🕒 Running daily AuditLog cleanup job...");
    try {
      const { AuditLog } = initMasterModels(masterSequelize);
      
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const deletedCount = await AuditLog.destroy({
        where: {
          createdAt: {
            [Op.lt]: thirtyDaysAgo,
          },
        },
      });

      console.log(`✅ AuditLog cleanup successful. Deleted ${deletedCount} old records.`);
    } catch (error) {
      console.error("❌ AuditLog cleanup failed:", error.message);
    }

    try {
      const deletedKeys = await cleanupExpiredIdempotencyKeys();
      console.log(`✅ IdempotencyKey cleanup successful. Deleted ${deletedKeys} expired keys.`);
    } catch (error) {
      console.error("❌ IdempotencyKey cleanup failed:", error.message);
    }

    try {
      const integrityReports = await runNightlyStockIntegrityCheck();
      console.log(`✅ Nightly retail stock integrity check completed (${integrityReports.length} retail tenant(s)).`);
    } catch (error) {
      console.error("❌ Nightly retail stock integrity check failed:", error.message);
    }
  });
};

export default setupCronJobs;
