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
import { repairZeroDates } from "../../migrations/lib/schemaGuards.js";

import { Sequelize } from "sequelize";
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

  it("legacy invalid dates ('0000-00-00') in EXPENSES — as in the seeded demo tenant — do not block the accounting migration", async () => {
    // This is what production hit: converting EXPENSES.category makes MySQL copy the table, and strict
    // mode refuses to copy a row whose createdAt is the invalid date 0000-00-00 00:00:00.
    await freshSchema();
    await q("DROP TABLE IF EXISTS EXPENSE_AUDIT");
    await dropColumn("PAYMENTS", "received_by_user_id");
    await q("ALTER TABLE EXPENSES MODIFY category ENUM('Maintenance','Fuel','Salary','Other') NOT NULL");
    await sequelize.transaction(async (t) => {
      // the legacy row could only be written with strict date checks off
      await q("SET SESSION sql_mode = ''", { transaction: t });
      await q("INSERT INTO EXPENSES (category, amount, date, description, createdAt, updatedAt) VALUES ('Fuel', 1500, NOW(), 'legacy row', '0000-00-00 00:00:00', '0000-00-00 00:00:00')", { transaction: t });
      await q("SET SESSION sql_mode = DEFAULT", { transaction: t });
    });

    const migration = await import(pathToFileURL(path.join(DIR, "20261025100000-accounting-fixes.js")).href);
    await expect(migration.up({ context: sequelize.getQueryInterface() })).resolves.not.toThrow();

    const cols = await sequelize.getQueryInterface().describeTable("EXPENSES");
    expect(cols.category.type).toMatch(/varchar/i);
    const [row] = await q("SELECT description, CAST(createdAt AS CHAR) AS createdAt, CAST(updatedAt AS CHAR) AS updatedAt FROM EXPENSES", { type: "SELECT" });
    expect(row.description).toBe("legacy row"); // data is kept…
    expect(row.createdAt).not.toMatch(/^0000/); // …and the invalid dates are repaired
    expect(row.updatedAt).not.toMatch(/^0000/);
  }, 60000);

  it("the demo tenant's exact situation: three migrations pending, invalid legacy dates in several tables", async () => {
    await freshSchema();
    const umzug = umzugFor(sequelize);
    const pendingNames = FILES.slice(-3); // accounting-fixes, equipment images, whatsapp hub
    expect(pendingNames[0]).toBe("20261025100000-accounting-fixes.js");
    expect(pendingNames[2]).toBe("20261027100000-whatsapp-hub.js");
    await umzug.executed(); // creates the tracking table
    for (const f of FILES.slice(0, -3)) await umzug.storage.logMigration({ name: f });

    // rewind what the three pending migrations add
    await q("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of ["EXPENSE_AUDIT", "EXPENSE_AUDITS", "WHATSAPP_MESSAGE_LOGS", "WHATSAPP_TEMPLATES"]) await q(`DROP TABLE IF EXISTS \`${t}\``);
    await q("SET FOREIGN_KEY_CHECKS = 1");
    await dropColumn("PAYMENTS", "received_by_user_id");
    await dropColumn("CUSTOMERS", "whatsapp_opt_out");
    await q("ALTER TABLE EXPENSES MODIFY category ENUM('Maintenance','Fuel','Salary','Other') NOT NULL");

    // legacy rows with invalid dates in the tables these migrations touch
    const category = await models.EquipmentCategory.create({ category_name: "Tools" });
    const warehouse = await models.Warehouse.create({ location_name: "Yard" });
    await sequelize.transaction(async (t) => {
      await q("SET SESSION sql_mode = ''", { transaction: t });
      const zero = "'0000-00-00 00:00:00'";
      await q(`INSERT INTO EXPENSES (category, amount, date, createdAt, updatedAt) VALUES ('Fuel', 100, NOW(), ${zero}, ${zero})`, { transaction: t });
      await q(`INSERT INTO CUSTOMERS (nic_number, first_name, last_name, phone_number, createdAt, updatedAt) VALUES ('NICZ1', 'Old', 'Customer', '0771234567', ${zero}, ${zero})`, { transaction: t });
      await q(
        `INSERT INTO EQUIPMENT (category_id, warehouse_id, equipment_name, serial_number, base_rental_price, extra_daily_rate, createdAt, updatedAt) VALUES (${category.category_id}, ${warehouse.warehouse_id}, 'Aluminium Step Ladder', 'EQ-Z1', 1500, 1500, ${zero}, ${zero})`,
        { transaction: t },
      );
      await q("SET SESSION sql_mode = DEFAULT", { transaction: t });
    });

    expect((await umzug.pending()).map((m) => m.name)).toEqual(pendingNames);
    await expect(umzug.up()).resolves.toBeTruthy();
    expect(await umzug.pending()).toEqual([]);

    // the app's own queries work again, and nothing was lost
    const customers = await models.Customer.findAll({ attributes: ["customer_id", "first_name", "whatsapp_opt_out"] });
    expect(customers).toHaveLength(1);
    expect(customers[0].whatsapp_opt_out).toBe(false);
    const equipment = await q("SELECT equipment_name, image_url FROM EQUIPMENT", { type: "SELECT" });
    expect(equipment[0].equipment_name).toBe("Aluminium Step Ladder");
    expect(equipment[0].image_url).toMatch(/\/equipment\/step-ladder\.webp$/); // photo assigned by the images migration
  }, 120000);

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

  describe("repairZeroDates", () => {
    const withLegacyRows = async (rowsSql) => {
      await q("DROP TABLE IF EXISTS ZD_TEST");
      await q("CREATE TABLE ZD_TEST (id INT PRIMARY KEY AUTO_INCREMENT, a DATETIME NULL, b DATETIME NOT NULL, c DATE NULL, d TIMESTAMP NULL, note VARCHAR(20))");
      await sequelize.transaction(async (t) => {
        await q("SET SESSION sql_mode = ''", { transaction: t });
        await q(rowsSql, { transaction: t });
        await q("SET SESSION sql_mode = DEFAULT", { transaction: t });
      });
    };
    const all = () => q("SELECT id, CAST(a AS CHAR) a, CAST(b AS CHAR) b, CAST(c AS CHAR) c, CAST(d AS CHAR) d, note FROM ZD_TEST ORDER BY id", { type: "SELECT" });

    it("nulls nullable columns, stamps NOT NULL ones, leaves valid rows and other columns alone", async () => {
      await withLegacyRows(`INSERT INTO ZD_TEST (a, b, c, d, note) VALUES
        ('0000-00-00 00:00:00', '0000-00-00 00:00:00', '0000-00-00', '0000-00-00 00:00:00', 'zeros'),
        ('2026-03-01 10:00:00', '2026-03-02 11:00:00', '2026-03-03', '2026-03-04 12:00:00', 'valid')`);
      const repaired = await repairZeroDates(sequelize.getQueryInterface(), "ZD_TEST");
      expect(repaired).toBe(4);
      const [zeros, valid] = await all();
      expect(zeros).toMatchObject({ a: null, c: null, d: null, note: "zeros" });
      expect(zeros.b).not.toMatch(/^0000/); // NOT NULL column gets a real timestamp
      expect(valid).toMatchObject({ a: "2026-03-01 10:00:00", b: "2026-03-02 11:00:00", c: "2026-03-03", d: "2026-03-04 12:00:00" });
      expect(await repairZeroDates(sequelize.getQueryInterface(), "ZD_TEST")).toBe(0); // nothing left to do
    });

    it("the table can then be copied under strict mode (the original failure)", async () => {
      await withLegacyRows("INSERT INTO ZD_TEST (a, b, c, d, note) VALUES ('0000-00-00 00:00:00', '0000-00-00 00:00:00', NULL, NULL, 'x')");
      // a type change forces MySQL to copy the table (widening a VARCHAR would not), which validates every row
      await expect(q("ALTER TABLE ZD_TEST MODIFY note TEXT")).rejects.toThrow(/Incorrect datetime value/);
      await repairZeroDates(sequelize.getQueryInterface(), "ZD_TEST");
      await expect(q("ALTER TABLE ZD_TEST MODIFY note TEXT")).resolves.toBeTruthy();
    });

    it("does nothing for a table with no date columns or a missing table", async () => {
      await q("DROP TABLE IF EXISTS ZD_PLAIN");
      await q("CREATE TABLE ZD_PLAIN (id INT PRIMARY KEY, name VARCHAR(10))");
      expect(await repairZeroDates(sequelize.getQueryInterface(), "ZD_PLAIN")).toBe(0);
      expect(await repairZeroDates(sequelize.getQueryInterface(), "NO_SUCH_TABLE")).toBe(0);
    });

    it("puts the connection's SQL mode back (pooled connections are reused)", async () => {
      await withLegacyRows("INSERT INTO ZD_TEST (a, b, note) VALUES ('0000-00-00 00:00:00', '0000-00-00 00:00:00', 'x')");
      const single = new Sequelize(DB_URL.replace(/\/[^/]*$/, `/${sequelize.config.database}`), { dialect: "mysql", logging: false, pool: { max: 1 } });
      try {
        const [{ mode: modeBefore }] = await single.query("SELECT @@SESSION.sql_mode AS mode", { type: "SELECT" });
        await repairZeroDates(single.getQueryInterface(), "ZD_TEST");
        const [{ mode: modeAfter }] = await single.query("SELECT @@SESSION.sql_mode AS mode", { type: "SELECT" });
        expect(modeAfter).toBe(modeBefore);
        expect(modeAfter).toContain("NO_ZERO_DATE");
      } finally {
        await single.close();
      }
    });
  });
});
