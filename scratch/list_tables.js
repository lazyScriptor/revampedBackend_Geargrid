import { masterSequelize } from "../src/config/database.js";
import { QueryTypes } from "sequelize";

async function listTables() {
    try {
        const tables = await masterSequelize.query("SHOW TABLES", { type: QueryTypes.SELECT });
        console.log("Tables in geargrid_master:");
        console.log(JSON.stringify(tables, null, 2));
        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

listTables();
