// One-shot prod recovery for the ER_FK_INCOMPATIBLE_COLUMNS crash.
//
// Cause: TENANTS.tenant_id on prod is still INTEGER (old schema). The current
// models declare it VARCHAR(36) and TENANT_SUBSCRIPTIONS.tenant_id (also VARCHAR(36))
// has an FK pointing at it. sync() can't create the child table because the parent
// column type is wrong.
//
// Strategy: inspect the actual schema, then either:
//   (a) If TENANTS is empty → drop the master tables that depend on tenant_id, let
//       sync() rebuild them with the correct types on next boot.
//   (b) If TENANTS has data → bail out with instructions; manual data migration needed.
//
// Run once, on the server, before the first `npm run db:migrate:baseline`:
//   node src/scripts/recover-prod-schema.mjs

import "dotenv/config";
import { masterSequelize } from "../config/database.js";
import { QueryTypes } from "sequelize";

const log = (msg) => console.log(`[recover] ${msg}`);
const die = (msg) => {
  console.error(`[recover] ✗ ${msg}`);
  process.exit(1);
};

const main = async () => {
  await masterSequelize.authenticate();
  log("connected to master DB");

  // 1. Inspect TENANTS.tenant_id
  const cols = await masterSequelize.query(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'TENANTS'
         AND COLUMN_NAME = 'tenant_id'`,
    { type: QueryTypes.SELECT },
  );

  if (cols.length === 0) {
    log("TENANTS table doesn't exist — nothing to fix. sync() will create it.");
    return;
  }

  const { DATA_TYPE: dataType, COLUMN_TYPE: columnType } = cols[0];
  log(`current TENANTS.tenant_id: ${columnType} (${dataType})`);

  if (dataType.toLowerCase().startsWith("varchar") || dataType.toLowerCase() === "char") {
    log("✅ already a string type — nothing to do");
    return;
  }

  // 2. Check tenant count
  const [{ count }] = await masterSequelize.query(
    "SELECT COUNT(*) AS count FROM TENANTS",
    { type: QueryTypes.SELECT },
  );
  log(`TENANTS row count: ${count}`);

  if (count > 0) {
    die(
      `TENANTS has ${count} rows with integer tenant_id values that the new code expects as UUIDs. ` +
        "Aborting to avoid data loss. Manual data migration needed — write a master migration " +
        "that ALTERs the column AND backfills UUID values for existing rows.",
    );
  }

  // 3. Empty table → drop dependents + parent, let sync() rebuild
  log("TENANTS is empty — dropping FK-dependent tables so sync() can rebuild cleanly");

  await masterSequelize.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of [
    "TENANT_SUBSCRIPTIONS",
    "GLOBAL_USERS",
    "SUPER_ADMIN_AUDIT_LOG",
    "TENANTS",
  ]) {
    try {
      await masterSequelize.query(`DROP TABLE IF EXISTS \`${table}\``);
      log(`  dropped ${table}`);
    } catch (e) {
      log(`  ⚠️  could not drop ${table}: ${e.message}`);
    }
  }
  await masterSequelize.query("SET FOREIGN_KEY_CHECKS = 1");

  log("✅ recovery done. Now start the server — sync() will recreate the tables with VARCHAR(36).");
  log("   Then run: npm run db:migrate:baseline && pm2 restart rental-api");
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[recover] crashed:", err);
    process.exit(1);
  });
