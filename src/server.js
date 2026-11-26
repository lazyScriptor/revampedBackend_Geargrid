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
import { warnIfFirebaseUnconfigured } from "./services/devicePushService.js";

const PORT = process.env.PORT || 8086;

const startServer = async () => {
  try {
    // =================================================================
    // 1. CONNECT TO THE MASTER DATABASE
    // =================================================================
    await masterSequelize.authenticate();
    console.log("✅ Successfully connected to the geargrid_master database.");

    // Register Master DB ORM models (SuperAdmin, Tenant, GlobalUser, AuditLog)
    initMasterModels(masterSequelize);

    // No sequelize.sync() here, for the master or any tenant (root CLAUDE.md rule 1). Schema changes
    // are Umzug migrations, which the deploy runs (`npm run db:migrate`) before PM2 restarts us.
    // The startup sync used to check every model's table and indexes in every tenant before we
    // listened, which kept api.geargrid.live on 502 for ~2.5 minutes per restart, and it failed
    // part-way on tenants with legacy zero dates, leaving later tables (BULK_JOBS) uncreated.

    // Build combined CORS allow-list from platform-config + every tenant's whitelist
    try {
      await recomputeCorsOrigins();
      console.log("✅ CORS origins loaded (global + per-tenant whitelists).");
    } catch (corsErr) {
      console.warn("⚠️ Could not load CORS origins from DB — using defaults.", corsErr.message);
    }

    // =================================================================
    // 2. OPEN (AND CACHE) A CONNECTION TO EVERY TENANT DATABASE
    // =================================================================
    // Requests from already-signed-in users and the bulk job worker use getCachedTenantConnection(),
    // so the cache must be filled before we listen. This is one quick authenticate() per tenant.
    const tenants = await masterSequelize.query(
      "SELECT db_name, db_user, encrypted_db_pass, db_host FROM TENANTS",
      { type: QueryTypes.SELECT },
    );

    console.log(`🔄 Found ${tenants.length} tenant(s). Connecting to tenant databases...`);

    const results = await Promise.allSettled(
      tenants.map(async (tenant) => {
        const tenantConnection = await getTenantConnection(
          tenant.db_name,
          tenant.db_user,
          tenant.encrypted_db_pass,
          tenant.db_host,
        );
        initTenantModels(tenantConnection);
      }),
    );
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`❌Failed to connect: ${tenants[i].db_name}`, r.reason?.message);
      }
    });
    const connected = results.filter((r) => r.status === "fulfilled").length;
    console.log(`✅ Connected to ${connected}/${tenants.length} tenant database(s).`);

    // =================================================================
    // 3. START EXPRESS SERVER + SOCKET.IO + BULK JOB WORKER
    // =================================================================
    const httpServer = http.createServer(app);
    initSocketServer(httpServer);
    httpServer.listen(PORT, () => {
      console.log(`Revamped Production Backend is running on port ${PORT}`);
      console.log(`🔌 socket.io listening on the same port`);
      warnIfFirebaseUnconfigured();
      setupCronJobs();
      startBulkJobWorker();
    });
  } catch (error) {
    console.error(" Critical Startup Error:", error);
    process.exit(1); // Stop the server if the master DB is down
  } // <--- Added closing catch brace
}; // <--- Added closing function brace

startServer();
