import cron from "node-cron";
import { getTenantConnection, masterSequelize } from "../config/database.js";
import { Op } from "sequelize";
import { initMasterModels } from "../models/master/index.js";
import { initTenantModels } from "../models/index.js";

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
  });
};

export default setupCronJobs;
