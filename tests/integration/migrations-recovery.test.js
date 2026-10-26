// Real-MySQL test of the "stuck tenant" bug: a tenant whose SequelizeMeta tracking is missing replays
// migrations from the very first one. Old migrations used plain addColumn/addIndex, which throw
// "Duplicate column/key" on a schema that already has them, so the runner stopped that tenant at the
// first old migration and every newer migration (WhatsApp, images, soft delete…) never ran — the app
// then failed with "Unknown column …". Every tenant migration must now cope with "already done".
//
// Skipped unless GG_TEST_MYSQL_URL is set (see whatsapp-mysql.test.js). Wipes the database it points at.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Umzug, SequelizeStorage } from "umzug";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { initTenantModels } from "../../src/models/index.js";

import { DB_URL, openTestDb } from "./mysqlTestDb.js";
const DIR = path.resolve(__dirname, "../../migrations/tenant");
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith(".js")).sort();

// the same wiring as src/scripts/migrate.js (that script reads .env, so it cannot be imported here)
const umzugFor = (sequelize) =>
  new Umzug({
    migrations: FILES.map((f) => ({
      name: f,
      up: async ({ context }) => (await import(pathToFileURL(path.join(DIR, f)).href)).up({ context }),
      down: async ({ context }) => (await import(pathToFileURL(path.join(DIR, f)).href)).down({ context }),
    })),
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize, modelName: "SequelizeMeta" }),
    logger: undefined,
  });

describe.skipIf(!DB_URL)("tenant migrations recover a tenant with missing tracking", () => {
  let sequelize;
  let models;
  const q = (sql, opts) => sequelize.query(sql, opts);

  const freshSchema = async () => {
    await q("SET FOREIGN_KEY_CHECKS = 0");
    await sequelize.sync({ force: true });
    await q("DROP TABLE IF EXISTS SequelizeMeta");
    await q("SET FOREIGN_KEY_CHECKS = 1");
    await q("INSERT INTO ROLES (role_name, hierarchy_level) VALUES ('Administrator', 100), ('Cashier', 10)").catch(() =>
      q("INSERT INTO ROLES (role_name, hierarchy_level, createdAt, updatedAt) VALUES ('Administrator', 100, NOW(), NOW()), ('Cashier', 10, NOW(), NOW())"),
    );
  };

  // remove a column even when a foreign key uses it
  const dropColumn = async (table, column) => {
    const fks = await q(
      "SELECT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL",
      { replacements: [table, column], type: "SELECT" },
    );
    for (const fk of fks) await q(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${fk.name}\``);
    const idx = await q("SELECT DISTINCT INDEX_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND INDEX_NAME <> 'PRIMARY'", {
      replacements: [table, column],
      type: "SELECT",
    });
    for (const i of idx) await q(`ALTER TABLE \`${table}\` DROP INDEX \`${i.name}\``).catch(() => {});
    await q(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
  };

  beforeAll(async () => {
    sequelize = await openTestDb("mig");
    models = initTenantModels(sequelize);
  }, 60000);

  afterAll(async () => {
    await sequelize?.close();
  });

  it("a tenant whose schema is current but whose tracking rows are missing migrates cleanly (no 'Duplicate column/key')", async () => {
    await freshSchema();
    const umzug = umzugFor(sequelize);
    await expect(umzug.up()).resolves.toBeTruthy();
    expect((await umzug.executed()).map((m) => m.name)).toEqual(FILES);
    expect(await umzug.pending()).toEqual([]);
  }, 60000);

  it("running everything a second time is also harmless", async () => {
    // wipe only the tracking rows: the schema stays as migrated
    await q("DELETE FROM SequelizeMeta");
    await expect(umzugFor(sequelize).up()).resolves.toBeTruthy();
  }, 60000);

  it("a genuinely OLD schema with no tracking catches up completely, and every model queries without 'Unknown column'", async () => {
    await freshSchema();
    // rewind what the migrations add, to look like a tenant that never received them
    await q("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of ["INVOICE_REVIEWS", "INVOICE_PRINT_LOGS", "SIGNATURE_REQUESTS", "INVOICE_SIGNATURES", "OPERATOR_DEVICES", "WHATSAPP_MESSAGE_LOGS", "WHATSAPP_TEMPLATES", "EXPENSE_AUDIT", "EXPENSE_AUDITS"]) {
      await q(`DROP TABLE IF EXISTS \`${t}\``);
    }
    await q("SET FOREIGN_KEY_CHECKS = 1");
    for (const [table, column] of [
      ["INVOICE_LINES", "track_overdue"],
      ["INVOICES", "borrowed_on_behalf_of_customer_id"],
      ["INVOICES", "is_deleted"],
      ["INVOICES", "delete_reason"],
      ["PAYMENTS", "is_voided"],
      ["PAYMENTS", "received_by_user_id"],
      ["EQUIPMENT", "equipment_name_si"],
      ["CUSTOMERS", "whatsapp_opt_out"],
    ]) {
      await dropColumn(table, column);
    }
    // the app code at this point would fail exactly like production did
    await expect(models.Customer.findAll({ limit: 1 })).rejects.toThrow(/Unknown column .*whatsapp_opt_out/);

    const umzug = umzugFor(sequelize);
    await umzug.up();
    expect((await umzug.executed()).map((m) => m.name)).toEqual(FILES);

    for (const name of ["Customer", "Invoice", "InvoiceLine", "Payment", "Equipment", "WhatsappMessageLog", "WhatsappTemplate"]) {
      await expect(models[name].findAll({ limit: 1 }), name).resolves.toEqual([]);
    }
    const cols = await sequelize.getQueryInterface().describeTable("INVOICE_LINES");
    expect(cols.track_overdue).toBeTruthy();
  }, 120000);
});
