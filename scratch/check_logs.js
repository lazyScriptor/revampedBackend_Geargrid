import { masterSequelize } from "../src/config/database.js";
import { QueryTypes } from "sequelize";

async function checkAuditLog() {
    try {
        const logs = await masterSequelize.query("SELECT * FROM AUDIT_LOGS WHERE details LIKE '%admin7@myrental.com%'", { type: QueryTypes.SELECT });
        console.log("Audit Logs for admin7:");
        console.log(JSON.stringify(logs, null, 2));
        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

checkAuditLog();
