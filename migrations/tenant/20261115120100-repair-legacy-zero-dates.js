// migrations/tenant/20261115120100-repair-legacy-zero-dates.js
// Replace invalid "zero dates" (0000-00-00 00:00:00) in every table of the tenant database.
//
// Why: production startup logged "❌Failed to sync: geargrid_tenant_template Incorrect datetime value:
// '0000-00-00 00:00:00' for column 'createdAt'". The template's seeded rows were written with MySQL's
// date checks off; in a local copy they are USERS.createdAt and INVOICE_TRACE.createdAt/updatedAt.
// Such rows are harmless until something makes MySQL rebuild the table (adding an index or changing a
// column), when strict mode rejects them and the whole statement fails. Shops copied from the template
// inherit the same rows, so this runs on every tenant; where there are none it changes nothing.
//
// NOT NULL columns get the current time, nullable ones NULL (see repairZeroDates). Safe to run twice:
// a second run finds no zero dates.
import { repairZeroDates } from "../lib/schemaGuards.js";

export const up = async ({ context: qi }) => {
  const tables = await qi.sequelize.query(
    "SELECT DISTINCT c.TABLE_NAME AS name FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME WHERE c.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE' AND c.DATA_TYPE IN ('date', 'datetime', 'timestamp') ORDER BY c.TABLE_NAME",
    { type: "SELECT" },
  );
  for (const { name } of tables) {
    const repaired = await repairZeroDates(qi, name);
    if (repaired) console.log(`  repaired ${repaired} zero date(s) in ${name}`);
  }
};

// The original zero dates are invalid values and are not restored.
export const down = async () => {};
