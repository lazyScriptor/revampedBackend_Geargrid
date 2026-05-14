import { masterSequelize } from "../src/config/database.js";
import { QueryTypes } from "sequelize";

async function checkGlobalUsers() {
    try {
        const columns = await masterSequelize.query("DESCRIBE GLOBAL_USERS", { type: QueryTypes.SELECT });
        console.log("GLOBAL_USERS Columns:");
        console.log(JSON.stringify(columns, null, 2));

        const users = await masterSequelize.query("SELECT * FROM GLOBAL_USERS", { type: QueryTypes.SELECT });
        console.log("GLOBAL_USERS Records:");
        console.log(JSON.stringify(users, null, 2));

        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

checkGlobalUsers();
