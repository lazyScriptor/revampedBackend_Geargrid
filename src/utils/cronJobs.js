import cron from "node-cron";
import { masterSequelize } from "../config/database.js";
import { Op } from "sequelize";
import { initMasterModels } from "../models/master/index.js";

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
};

export default setupCronJobs;
