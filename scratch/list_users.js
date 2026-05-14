import { masterSequelize } from "../src/config/database.js";
import { QueryTypes } from "sequelize";

async function listUsers() {
    try {
        const users = await masterSequelize.query("SELECT email FROM GLOBAL_USERS", { type: QueryTypes.SELECT });
        console.log("Registered Emails:");
        users.forEach(u => console.log(`- ${u.email}`));
        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

listUsers();
