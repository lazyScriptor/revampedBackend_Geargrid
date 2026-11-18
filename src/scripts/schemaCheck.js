// Read-only: list every tenant model table or column that is missing from each tenant database.
//
//   npm run db:schema:check
//
// The server no longer runs sequelize.sync() at startup (root CLAUDE.md rule 1), so nothing quietly
// fills schema gaps any more: a table or column the models expect must come from a migration. Run
// this after `npm run db:migrate` to confirm every tenant matches the models. It only reads
// information_schema. Table names are compared exactly (production MySQL is case-sensitive).
// Exits 1 if anything is missing.
import "dotenv/config";
import { QueryTypes } from "sequelize";
import { pathToFileURL } from "node:url";
import { masterSequelize, getTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";

/** Pure: compare the models' expected tables/columns with what the database has. */
export const findSchemaGaps = (expected, actual) => {
  const gaps = [];
  for (const [table, columns] of Object.entries(expected)) {
    const have = actual[table];
    if (!have) {
      gaps.push({ table, column: null });
      continue;
    }
    for (const column of columns) if (!have.has(column)) gaps.push({ table, column });
  }
  return gaps;
};

export const expectedSchema = (models) => {
  const out = {};
  for (const model of Object.values(models)) {
    if (!model?.getTableName || !model.rawAttributes) continue;
    const t = model.getTableName();
    const table = typeof t === "string" ? t : t.tableName;
    out[table] = Object.values(model.rawAttributes)
      .filter((a) => !a.type?.constructor?.name?.includes("VIRTUAL"))
      .map((a) => a.field || a.fieldName);
  }
  return out;
};

const actualSchema = async (conn) => {
  const rows = await conn.query(
    "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()",
    { type: QueryTypes.SELECT },
  );
  const out = {};
  for (const { t, c } of rows) (out[t] ??= new Set()).add(c);
  return out;
};

const main = async () => {
  const tenants = await masterSequelize.query(
    "SELECT db_name, db_user, encrypted_db_pass, db_host FROM TENANTS ORDER BY db_name",
    { type: QueryTypes.SELECT },
  );
  let problems = 0;
  for (const t of tenants) {
    try {
      const conn = await getTenantConnection(t.db_name, t.db_user, t.encrypted_db_pass, t.db_host);
      const gaps = findSchemaGaps(expectedSchema(initTenantModels(conn)), await actualSchema(conn));
      if (!gaps.length) {
        console.log(`✓ ${t.db_name}`);
        continue;
      }
      problems += gaps.length;
      console.log(`✗ ${t.db_name}`);
      for (const g of gaps) console.log(g.column ? `    missing column ${g.table}.${g.column}` : `    missing table  ${g.table}`);
    } catch (err) {
      problems += 1;
      console.log(`✗ ${t.db_name}: ${err.message}`);
    }
  }
  return problems ? 1 : 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("schema check crashed:", err);
      process.exit(2);
    });
}
