import http from "http";
import app from "./app.js";
import { masterSequelize, getTenantConnection } from "./config/database.js";
import { initTenantModels } from "./models/index.js";
import { initMasterModels } from "./models/master/index.js";
import { QueryTypes } from "sequelize";
import setupCronJobs from "./utils/cronJobs.js";
import { recomputeCorsOrigins } from "./services/superAdminTenantService.js";
import { initSocketServer } from "./sockets/index.js";
import { startBulkJobWorker } from "./workers/bulkJobWorker.js";

const PORT = process.env.PORT || 8086;

const startServer = async () => {
  try {
    // =================================================================
    // 1. SYNC THE MASTER DATABASE
    // =================================================================
    await masterSequelize.authenticate();
    console.log("✅ Successfully connected to the geargrid_master database.");

    // Register Master DB ORM models (SuperAdmin, Tenant, GlobalUser, AuditLog)
    initMasterModels(masterSequelize);

    // NOTE: Do NOT use { alter: true } — every restart adds another UNIQUE index
    // on columns marked unique, hitting MySQL's 64-index-per-column limit (ER_TOO_MANY_KEYS).
    // sync() only creates missing tables/columns. Use manual ALTER for type/index changes.
    await masterSequelize.sync();
    console.log("✅ Master Database structure synced.");

    // Build combined CORS allow-list from platform-config + every tenant's whitelist
    try {
      await recomputeCorsOrigins();
      console.log("✅ CORS origins loaded (global + per-tenant whitelists).");
    } catch (corsErr) {
      console.warn("⚠️ Could not load CORS origins from DB — using defaults.", corsErr.message);
    }

    // =================================================================
    // 2. FIND ALL TENANTS AND SYNC THEIR DATABASES
    // =================================================================
    // Look inside the master DB to find every client you have
    const tenants = await masterSequelize.query(
      "SELECT db_name, db_user, encrypted_db_pass, db_host FROM TENANTS",
      { type: QueryTypes.SELECT },
    );

    console.log(
      `🔄 Found ${tenants.length} tenant(s). Synchronizing tenant databases...`,
    );

    // Loop through each client's database one by one
    for (const tenant of tenants) {
      try {
        // Create a connection to this specific client's DB
        const tenantConnection = await getTenantConnection(
          tenant.db_name,
          tenant.db_user,
          tenant.encrypted_db_pass,
          tenant.db_host,
        );

        // Load the models into this connection so Sequelize knows the table structures
        initTenantModels(tenantConnection);

        // Give Sequelize authority to alter this specific client's tables
        await tenantConnection.sync();
        console.log(`***Successfully synced: ${tenant.db_name}`);
      } catch (tenantErr) {
        console.error(`❌Failed to sync: ${tenant.db_name}`, tenantErr.message);
      }
    }

    console.log("🎉 All database schemas are up to date!");

    // =================================================================
    // 3. START EXPRESS SERVER + SOCKET.IO + BULK JOB WORKER
    // =================================================================
    const httpServer = http.createServer(app);
    initSocketServer(httpServer);
    httpServer.listen(PORT, () => {
      console.log(`Revamped Production Backend is running on port ${PORT}`);
      console.log(`🔌 socket.io listening on the same port`);
      setupCronJobs();
      startBulkJobWorker();
    });
  } catch (error) {
    console.error(" Critical Startup Error:", error);
    process.exit(1); // Stop the server if the master DB is down
  } // <--- Added closing catch brace
}; // <--- Added closing function brace

startServer();
