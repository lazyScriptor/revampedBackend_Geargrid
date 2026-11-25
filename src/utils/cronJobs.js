import cron from "node-cron";
import { masterSequelize } from "../config/database.js";
import { Op } from "sequelize";
import { initMasterModels } from "../models/master/index.js";
import { runCallRetentionJob, runFollowUpJob } from "../services/scheduledJobs.js";

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
  });

  // 09:00 is inside shop hours, so a "promise missed" event isn't marked as after-hours.
  // FUTURE (super admin setting): reminder and clean-up times, per shop time zone.
  cron.schedule("0 9 * * *", () => runLogged("follow-up", runFollowUpJob), SHOP_TZ);
  cron.schedule("30 2 * * *", () => runLogged("call retention", runCallRetentionJob), SHOP_TZ);
};

const SHOP_TZ = { timezone: "Asia/Colombo" };

const runLogged = async (name, job) => {
  console.log(`🕒 Running daily ${name} job...`);
  try {
    const results = await job();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`✅ Daily ${name} job done: ${results.length - failed} shop(s) ok, ${failed} failed.`);
  } catch (error) {
    console.error(`❌ Daily ${name} job failed:`, error.message);
  }
};

export default setupCronJobs;
