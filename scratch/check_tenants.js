import { masterSequelize } from "../src/config/database.js";
import { QueryTypes } from "sequelize";

async function checkTenants() {
    try {
        const tenants = await masterSequelize.query("SELECT * FROM TENANTS", { type: QueryTypes.SELECT });
        console.log("Tenants:");
        console.log(JSON.stringify(tenants, null, 2));
        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

checkTenants();
