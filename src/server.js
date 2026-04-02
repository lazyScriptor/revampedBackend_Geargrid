import app from "./app.js";
import { masterSequelize, getTenantConnection } from "./config/database.js";
import { initTenantModels } from "./models/index.js";
import { QueryTypes } from "sequelize";

const PORT = process.env.PORT || 8086;

const startServer = async () => {
  try {
    // =================================================================
    // 1. SYNC THE MASTER DATABASE
    // =================================================================
    await masterSequelize.authenticate();
    console.log("✅ Successfully connected to the geargrid_master database.");

    // Give Sequelize authority to auto-create/update Master tables
    await masterSequelize.sync({  alter:true});
    console.log("✅ Master Database structure synced.");

    // =================================================================
    // 2. FIND ALL TENANTS AND SYNC THEIR DATABASES
    // =================================================================
    // Look inside the master DB to find every client you have
    const tenants = await masterSequelize.query(
      "SELECT db_name, db_user, encrypted_db_pass, db_host FROM TENANTS",
      { type: QueryTypes.SELECT }
    );

    console.log(`🔄 Found ${tenants.length} tenant(s). Synchronizing tenant databases...`);

    // Loop through each client's database one by one
    for (const tenant of tenants) {
      try {
        // Create a connection to this specific client's DB
        const tenantConnection = await getTenantConnection(
          tenant.db_name,
          tenant.db_user,
          tenant.encrypted_db_pass,
          tenant.db_host
        );

        // Load the models into this connection so Sequelize knows the table structures
        initTenantModels(tenantConnection);

        // Give Sequelize authority to alter this specific client's tables
        await tenantConnection.sync({  alter:true });
        console.log(`***Successfully synced: ${tenant.db_name}`);
      } catch (tenantErr) {
        console.error(`❌Failed to sync: ${tenant.db_name}`, tenantErr.message);
      }
    }

    console.log("🎉 All database schemas are up to date!");

    // =================================================================
    // 3. START EXPRESS SERVER
    // =================================================================
    app.listen(PORT, () => {
      console.log(`Revamped Production Backend is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌Critical Startup Error:", error);
    process.exit(1); // Stop the server if the master DB is down
  }
};

startServer();