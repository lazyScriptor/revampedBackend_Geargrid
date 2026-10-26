// Runs the WhatsApp hub against a REAL MySQL 8 (the unit tests use in-memory stand-ins, which
// cannot catch SQL mistakes: ONLY_FULL_GROUP_BY, case-sensitive table names, JSON columns,
// DATE handling, voided payments, soft-deleted invoices…).
//
// Skipped unless GG_TEST_MYSQL_URL is set, e.g.
//   GG_TEST_MYSQL_URL=mysql://root@127.0.0.1:33306/geargrid_test npx vitest run tests/integration/whatsapp-mysql.test.js
// Start MySQL with --lower-case-table-names=0 on a case-sensitive volume to match production
// (Ubuntu). The database name must contain "test": the test drops and recreates every table in it.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Sequelize } from "sequelize";
import { initTenantModels } from "../../src/models/index.js";
import * as wa from "../../src/services/whatsappService.js";
import { up as migrateUp, down as migrateDown } from "../../migrations/tenant/20261027100000-whatsapp-hub.js";

import { DB_URL, openTestDb } from "./mysqlTestDb.js";

describe.skipIf(!DB_URL)("WhatsApp hub on real MySQL", () => {
  let sequelize;
  let models;
  const ids = {};
  const today = wa.todayInTz("Asia/Colombo");
  const day = (n) => wa.addDays(today, n);
  const now = new Date();

  const makeInvoice = async (key, customer, { status = "Active", total = 10000, deleted = false, advance = 0 } = {}) => {
    const inv = await models.Invoice.create({
      customer_id: customer.customer_id,
      total_amount: total,
      sub_total: total,
      advance_paid: advance,
      number_of_days_of_the_bill: 3,
      status,
      is_deleted: deleted,
      issued_date: new Date(now.getTime() - 5 * 86400000),
    });
    ids[key] = inv.invoice_id;
    return inv;
  };
  const addLine = (invoice_id, equipment, { qty = 1, due, good = 0, defective = 0, track = true }) =>
    models.InvoiceLine.create({
      invoice_id,
      equipment_id: equipment.equipment_id,
      borrow_date: day(-10),
      expected_return_date: due,
      locked_base_price: 1500,
      locked_minimum_days: 1,
      locked_extra_daily_rate: 1500,
      borrow_quantity: qty,
      good_returned_qty: good,
      defective_returned_qty: defective,
      track_overdue: track,
    });
  const pay = (invoice_id, amount, voided = false) =>
    models.Payment.create({ invoice_id, payment_amount: amount, method: "CASH", is_voided: voided });
  // raw SQL, not a JS Date: sequelize formats raw replacements in the machine's local zone while the app stores UTC
  const setLogAgeHours = (logId, hours) =>
    sequelize.query("UPDATE WHATSAPP_MESSAGE_LOGS SET createdAt = DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? HOUR) WHERE log_id = ?", { replacements: [hours, logId] });

  beforeAll(async () => {
    sequelize = await openTestDb("wa");
    models = initTenantModels(sequelize);
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 0");
    await sequelize.sync({ force: true });
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1");

    await models.TenantConfig.create({
      business_display_name: "GearCo",
      timezone: "Asia/Colombo",
      custom_settings: { keep: "me", whatsapp: { shop_phone: "011 555 0000" } },
    });
    const category = await models.EquipmentCategory.create({ category_name: "Tools" });
    const warehouse = await models.Warehouse.create({ location_name: "Main yard" });
    const eq = async (name, serial, si = null) =>
      models.Equipment.create({
        category_id: category.category_id,
        warehouse_id: warehouse.warehouse_id,
        equipment_name: name,
        equipment_name_si: si,
        serial_number: serial,
        base_rental_price: 1500,
        extra_daily_rate: 1500,
        total_owned_qty: 10,
        available_qty: 5,
      });
    const drill = await eq("Hammer Drill", "EQ-0001", "හැමර් ඩ්‍රිල්");
    const ladder = await eq("Step Ladder", "EQ-0014");
    const gen = await eq("Generator", "EQ-0030");

    let nic = 100;
    const customer = (over) => models.Customer.create({ nic_number: `NIC${nic++}`, last_name: "X", phone_number: "0771234567", ...over });
    const nimal = await customer({ first_name: "Nimal", last_name: "Perera" });
    const abc = await customer({ first_name: "A", last_name: "B", customer_type: "Business", company_name: "ABC Builders", phone_number: "011 2345678 / +94 71 222 3333" });
    const kamal = await customer({ first_name: "Kamal", last_name: "Silva", phone_number: "0112345678" });
    const ruwan = await customer({ first_name: "Ruwan", last_name: "Jay", whatsapp_opt_out: true });
    const oscar = await customer({ first_name: "Oscar", last_name: "De Silva", phone_number: "078 444 5555" });
    const nophone = await customer({ first_name: "Nadee", last_name: "Phone", phone_number: "" });
    const ghost = await customer({ first_name: "Gone", last_name: "Away" });

    // ── returns ──
    const A = await makeInvoice("overdue", nimal);
    await addLine(A.invoice_id, drill, { qty: 2, due: day(-6) });

    const B = await makeInvoice("dueToday", abc);
    await addLine(B.invoice_id, ladder, { qty: 1, due: day(-8), good: 1 }); // already back
    await addLine(B.invoice_id, gen, { qty: 1, due: day(0) });

    const C = await makeInvoice("dueTomorrow", kamal);
    await addLine(C.invoice_id, drill, { qty: 1, due: day(1) });

    const D = await makeInvoice("dueNextWeek", nimal);
    await addLine(D.invoice_id, drill, { qty: 1, due: day(8) });

    const E = await makeInvoice("untracked", nimal);
    await addLine(E.invoice_id, drill, { qty: 1, due: day(-20), track: false });

    const F = await makeInvoice("partial", ruwan);
    await addLine(F.invoice_id, drill, { qty: 3, due: day(-1), good: 1, defective: 1 }); // 1 unit still out

    const G = await makeInvoice("allBack", nimal);
    await addLine(G.invoice_id, drill, { qty: 2, due: day(-9), good: 2 });

    const K = await makeInvoice("deleted", ghost, { deleted: true });
    await addLine(K.invoice_id, drill, { qty: 1, due: day(-4) });

    const L = await makeInvoice("mixedDates", nimal);
    await addLine(L.invoice_id, drill, { qty: 1, due: day(-4) });
    await addLine(L.invoice_id, ladder, { qty: 2, due: day(25) });

    const O = await makeInvoice("noPhone", nophone);
    await addLine(O.invoice_id, ladder, { qty: 1, due: day(0) });

    // ── money ──
    const H = await makeInvoice("owes", oscar, { status: "PendingPayment", total: 10000 });
    await pay(H.invoice_id, 4000);
    await pay(H.invoice_id, 3000, true); // voided → must not count as paid
    const I = await makeInvoice("settled", oscar, { status: "PendingPayment", total: 5000 });
    await pay(I.invoice_id, 5000);
    await makeInvoice("completedUnpaid", oscar, { status: "Completed", total: 8000 });
    await makeInvoice("noPayments", oscar, { status: "PendingPayment", total: 7000, advance: 1000 });

    // ── history ──
    const log = await models.WhatsappMessageLog.create({ customer_id: nimal.customer_id, invoice_id: A.invoice_id, template_key: "overdue_return", language: "si", to_phone: "94771234567", body: "earlier", status: "sent" });
    await setLogAgeHours(log.log_id, 2);
    ids.nimal = nimal.customer_id;
    ids.ruwan = ruwan.customer_id;
  }, 60000);

  afterAll(async () => {
    await sequelize?.close();
  });

  // ─── Today worklist ────────────────────────────────────────────────────────

  describe("getWorklist", () => {
    let w;
    beforeAll(async () => {
      w = await wa.getWorklist(models, { now });
    });
    const inSection = (section) => w.sections[section].map((i) => i.invoice_id).sort((a, b) => a - b);

    it("runs both SQL statements without error (ONLY_FULL_GROUP_BY, table names)", () => {
      expect(w.today).toBe(today);
    });

    it("lists overdue returns, including partial returns and mixed due dates, newest-late first", () => {
      expect(inSection("overdue_returns")).toEqual([ids.overdue, ids.partial, ids.mixedDates].sort((a, b) => a - b));
      expect(w.sections.overdue_returns[0].invoice_id).toBe(ids.overdue); // 6 days late is the most overdue
      const mixed = w.sections.overdue_returns.find((i) => i.invoice_id === ids.mixedDates);
      expect(mixed.days_late).toBe(4); // earliest pending due date wins
    });

    it("counts only machines still out on a partly returned line", () => {
      const partial = w.sections.overdue_returns.find((i) => i.invoice_id === ids.partial);
      expect(partial.pending_units).toBe(1); // 3 borrowed − 1 good − 1 defective
      expect(partial.items).toContain("1 × Hammer Drill");
      expect(partial.days_late).toBe(1);
    });

    it("due today / tomorrow", () => {
      expect(inSection("returns_due_today")).toEqual([ids.dueToday, ids.noPhone].sort((a, b) => a - b));
      expect(inSection("returns_due_tomorrow")).toEqual([ids.dueTomorrow]);
      const today1 = w.sections.returns_due_today.find((i) => i.invoice_id === ids.dueToday);
      expect(today1.items).toContain("Generator");
      expect(today1.items).not.toContain("Step Ladder"); // that line is already back
      expect(today1.customer.name).toBe("ABC Builders");
      expect(today1.customer.phone.digits).toBe("94712223333"); // multi-number field → the mobile
    });

    it("leaves out everything that should not be chased", () => {
      const all = Object.values(w.sections).flat().map((i) => i.invoice_id);
      for (const key of ["dueNextWeek", "untracked", "allBack", "deleted", "settled", "completedUnpaid"]) {
        expect(all, key).not.toContain(ids[key]);
      }
    });

    it("money owed ignores voided payments and fully-paid invoices", () => {
      expect(inSection("payments_pending")).toEqual([ids.owes, ids.noPayments].sort((a, b) => a - b));
      const owes = w.sections.payments_pending.find((i) => i.invoice_id === ids.owes);
      expect(owes.balance).toBe(6000); // 10000 − 4000; the voided 3000 does not count
      expect(owes.body).toContain("Rs. 4,000");
      expect(owes.body).toContain("Rs. 6,000");
      const none = w.sections.payments_pending.find((i) => i.invoice_id === ids.noPayments);
      expect(none.balance).toBe(7000);
      expect(w.summary.balance_pending).toBe(13000);
    });

    it("summary matches the sections", () => {
      expect(w.summary).toMatchObject({ overdue_returns: 3, returns_due_today: 2, returns_due_tomorrow: 1, payments_pending: 2 });
    });

    it("flags the awkward customers", () => {
      const byId = (section, id) => w.sections[section].find((i) => i.invoice_id === id);
      expect(byId("returns_due_tomorrow", ids.dueTomorrow).warnings).toContain("landline");
      expect(byId("returns_due_today", ids.noPhone).warnings).toContain("no_phone");
      const optedOut = byId("overdue_returns", ids.partial);
      expect(optedOut.customer.opted_out).toBe(true);
      expect(optedOut.warnings).toContain("opted_out");
    });

    it("remembers language and last message from the log", () => {
      const row = w.sections.overdue_returns.find((i) => i.invoice_id === ids.overdue);
      expect(row.language).toBe("si"); // last chat with this customer was Sinhala
      expect(row.body).toContain("ඉන්වොයිසිය");
      expect(row.last_message).toMatchObject({ template_key: "overdue_return", status: "sent" });
      expect(row.warnings).toContain("messaged_recently");
    });

    it("uses the shop's phone from the JSON settings column", () => {
      const row = w.sections.returns_due_today[0];
      expect(row.body).toContain("011 555 0000");
    });

    it("builds wa.me links that decode back to the message", () => {
      for (const item of Object.values(w.sections).flat()) {
        expect(item.link.startsWith("https://wa.me/")).toBe(true);
        expect(decodeURIComponent(item.link.split("?text=")[1])).toBe(item.body);
      }
    });
  });

  // ─── volume: forgotten, never-closed invoices must not hide today's work ───

  describe("getWorklist with a pile of old overdue invoices", () => {
    it("still shows what is due today and tomorrow, and says the overdue list is cut short", async () => {
      const ghost = await models.Customer.findOne({ where: { first_name: "Gone" } });
      const equipment = await models.Equipment.findOne();
      const invoices = await models.Invoice.bulkCreate(
        Array.from({ length: 320 }, () => ({ customer_id: ghost.customer_id, total_amount: 1000, sub_total: 1000, number_of_days_of_the_bill: 1, status: "Active", issued_date: new Date(now.getTime() - 200 * 86400000) })),
      );
      await models.InvoiceLine.bulkCreate(
        invoices.map((inv) => ({
          invoice_id: inv.invoice_id,
          equipment_id: equipment.equipment_id,
          borrow_date: day(-120),
          expected_return_date: day(-100), // far older than anything due today
          locked_base_price: 1500,
          locked_minimum_days: 1,
          locked_extra_daily_rate: 1500,
          borrow_quantity: 1,
        })),
      );
      const w = await wa.getWorklist(models, { now });
      expect(w.sections.overdue_returns).toHaveLength(300);
      expect(w.truncated.overdue_returns).toBe(true);
      expect(w.sections.returns_due_today.map((i) => i.invoice_id).sort((a, b) => a - b)).toEqual([ids.dueToday, ids.noPhone].sort((a, b) => a - b));
      expect(w.sections.returns_due_tomorrow.map((i) => i.invoice_id)).toEqual([ids.dueTomorrow]);
      expect(w.truncated.returns_due_today).toBe(false);
      // clean up so later tests see the original data
      await models.InvoiceLine.destroy({ where: { invoice_id: invoices.map((i) => i.invoice_id) } });
      await models.Invoice.destroy({ where: { invoice_id: invoices.map((i) => i.invoice_id) }, force: true });
    });
  });

  // ─── compose (Sequelize includes, payments query) ──────────────────────────

  describe("composeMessage", () => {
    it("receipt: real totals, voided payments excluded, machines with their numbers", async () => {
      const r = await wa.composeMessage(models, { template_key: "receipt", invoice_id: ids.owes, language: "en" });
      expect(r.body).toContain("Total: Rs. 10,000");
      expect(r.body).toContain("Paid: Rs. 4,000");
      expect(r.body).toContain("Balance: Rs. 6,000");
      expect(r.invoice.balance).toBe(6000);
    });

    it("shows the advance line when the invoice has one", async () => {
      const r = await wa.composeMessage(models, { template_key: "receipt", invoice_id: ids.noPayments, language: "en" });
      expect(r.body).toContain("Advance: Rs. 1,000");
    });

    it("lists the machines via the Equipment include, in either language", async () => {
      const en = await wa.composeMessage(models, { template_key: "receipt", invoice_id: ids.overdue, language: "en" });
      expect(en.body).toContain("• 2 × Hammer Drill (EQ-0001)");
      const si = await wa.composeMessage(models, { template_key: "receipt", invoice_id: ids.overdue, language: "si" });
      expect(si.body).toContain("හැමර් ඩ්‍රිල් (EQ-0001)");
    });

    it("return reminder uses the real due date and skips returned lines", async () => {
      const r = await wa.composeMessage(models, { template_key: "return_due_today", invoice_id: ids.dueToday, language: "en" });
      expect(r.body).toContain("Generator");
      expect(r.body).not.toContain("Step Ladder");
      expect(r.warnings).not.toContain("nothing_to_return");
      const done = await wa.composeMessage(models, { template_key: "return_due_today", invoice_id: ids.allBack, language: "en" });
      expect(done.warnings).toContain("nothing_to_return");
    });

    it("picks up the customer's last language from the log", async () => {
      const r = await wa.composeMessage(models, { template_key: "payment_reminder", invoice_id: ids.overdue });
      expect(r.language).toBe("si");
    });

    it("a soft-deleted invoice cannot be messaged about (404)", async () => {
      await expect(wa.composeMessage(models, { template_key: "receipt", invoice_id: ids.deleted })).rejects.toMatchObject({ statusCode: 404 });
    });

    it("custom message to a customer without an invoice", async () => {
      const r = await wa.composeMessage(models, { template_key: "custom", customer_id: ids.nimal, custom_text: "Your drill is ready" });
      expect(r.body).toBe("Your drill is ready");
      expect(r.to.digits).toBe("94771234567");
    });
  });

  // ─── log, templates, settings, opt-out on the real tables ──────────────────

  describe("persistence", () => {
    it("logs a chat, confirms it, lists it newest-first with names", async () => {
      const row = await wa.logMessage(models, { customer_id: ids.nimal, invoice_id: ids.overdue, template_key: "receipt", language: "en", to_phone: "+94 77 123 4567", body: "Hello 👋 ඉන්වොයිසිය", userId: 3 });
      expect(row.to_phone).toBe("94771234567");
      await wa.confirmSent(models, row.log_id);
      const list = await wa.listLog(models, { customer_id: ids.nimal });
      expect(list.total).toBeGreaterThanOrEqual(2);
      expect(list.entries[0]).toMatchObject({ log_id: row.log_id, status: "sent", customer_name: "Nimal Perera", invoice_number: `INV-${ids.overdue}` });
      expect(list.entries[0].body).toBe("Hello 👋 ඉන්වොයිසිය"); // emoji + Sinhala survive utf8mb4
    });

    it("opt-out blocks logging until lifted", async () => {
      await wa.setOptOut(models, ids.ruwan, true);
      await expect(wa.logMessage(models, { customer_id: ids.ruwan, template_key: "receipt", to_phone: "94771234567", body: "hi" })).rejects.toMatchObject({ statusCode: 409 });
      await wa.setOptOut(models, ids.ruwan, false);
      await expect(wa.logMessage(models, { customer_id: ids.ruwan, template_key: "receipt", to_phone: "94771234567", body: "hi" })).resolves.toBeTruthy();
    });

    it("templates: create, update in place (unique index), list flags, reset", async () => {
      await wa.saveTemplate(models, { key: "thank_you", language: "en", body: "First {{customer_name}}", userId: 1 });
      await wa.saveTemplate(models, { key: "thank_you", language: "en", body: "Second {{customer_name}}", userId: 2 });
      const [{ n }] = await sequelize.query("SELECT COUNT(*) AS n FROM WHATSAPP_TEMPLATES WHERE template_key='thank_you' AND language='en'", { type: "SELECT" });
      expect(Number(n)).toBe(1);
      const t = await wa.getTemplates(models);
      expect(t.templates.thank_you.en).toMatchObject({ body: "Second {{customer_name}}", is_custom: true });
      const r = await wa.composeMessage(models, { template_key: "thank_you", invoice_id: ids.overdue, language: "en" });
      expect(r.body).toBe("Second Nimal Perera");
      await wa.resetTemplate(models, { key: "thank_you", language: "en" });
      expect((await wa.getTemplates(models)).templates.thank_you.en.is_custom).toBe(false);
    });

    it("the unique index really rejects a duplicate (key, language)", async () => {
      await models.WhatsappTemplate.create({ template_key: "custom", language: "si", body: "a" });
      await expect(models.WhatsappTemplate.create({ template_key: "custom", language: "si", body: "b" })).rejects.toThrow();
      await models.WhatsappTemplate.destroy({ where: { template_key: "custom", language: "si" } });
    });

    it("settings: reads and writes the JSON column without clobbering other keys", async () => {
      expect(await wa.getSettings(models)).toMatchObject({ shop_name: "GearCo", shop_phone: "011 555 0000", default_language: "en" });
      const updated = await wa.updateSettings(models, { shop_phone: "077 999 8888", default_language: "si" });
      expect(updated).toMatchObject({ shop_phone: "077 999 8888", default_language: "si" });
      const [row] = await sequelize.query("SELECT custom_settings FROM TENANT_CONFIG LIMIT 1", { type: "SELECT" });
      const stored = typeof row.custom_settings === "string" ? JSON.parse(row.custom_settings) : row.custom_settings;
      expect(stored.keep).toBe("me");
      expect(stored.whatsapp).toMatchObject({ shop_phone: "077 999 8888", default_language: "si" });
      await wa.updateSettings(models, { shop_phone: "011 555 0000", default_language: "en" });
    });
  });

  // ─── the migration, on real MySQL ──────────────────────────────────────────

  describe("migration 20261027100000-whatsapp-hub", () => {
    const showTables = async () => (await sequelize.query("SHOW TABLES"))[0].map((r) => Object.values(r)[0]);
    const grantsFor = async (code) =>
      (await sequelize.query(
        "SELECT r.role_name FROM ROLE_PERMISSIONs rp JOIN ROLES r ON r.role_id = rp.role_id JOIN PERMISSIONS p ON p.permission_id = rp.permission_id WHERE p.permission_code = ? ORDER BY r.role_name",
        { replacements: [code], type: "SELECT" },
      )).map((r) => r.role_name);

    beforeAll(async () => {
      // an "existing production tenant": WhatsApp objects absent, roles and permissions present
      await sequelize.query("DROP TABLE IF EXISTS WHATSAPP_MESSAGE_LOGS");
      await sequelize.query("DROP TABLE IF EXISTS WHATSAPP_TEMPLATES");
      await sequelize.query("ALTER TABLE CUSTOMERS DROP COLUMN whatsapp_opt_out");
      const admin = await models.Role.create({ role_name: "Administrator", hierarchy_level: 100 });
      const cashier = await models.Role.create({ role_name: "Cashier", hierarchy_level: 10 });
      const stockman = await models.Role.create({ role_name: "Stockman", hierarchy_level: 10 });
      const view = await models.Permission.create({ permission_code: "invoice:view", module_name: "Invoices" });
      // the junction table is spelled ROLE_PERMISSIONs on a case-sensitive server (golden rule 3)
      await sequelize.query("INSERT INTO ROLE_PERMISSIONs (role_id, permission_id) VALUES (?, ?), (?, ?)", {
        replacements: [admin.role_id, view.permission_id, cashier.role_id, view.permission_id],
      });
      void stockman;
    });

    it("creates the tables, column and permissions", async () => {
      await migrateUp({ context: sequelize.getQueryInterface() });
      const tables = await showTables();
      expect(tables).toContain("WHATSAPP_MESSAGE_LOGS");
      expect(tables).toContain("WHATSAPP_TEMPLATES");
      const cols = await sequelize.getQueryInterface().describeTable("CUSTOMERS");
      expect(cols.whatsapp_opt_out).toBeTruthy();
      const perms = (await sequelize.query("SELECT permission_code FROM PERMISSIONS WHERE permission_code LIKE 'whatsapp:%' ORDER BY 1", { type: "SELECT" })).map((p) => p.permission_code);
      expect(perms).toEqual(["whatsapp:manage", "whatsapp:send"]);
    });

    it("grants send+manage to admins, send to invoice viewers, nothing to others", async () => {
      expect(await grantsFor("whatsapp:send")).toEqual(["Administrator", "Cashier"]);
      expect(await grantsFor("whatsapp:manage")).toEqual(["Administrator"]);
    });

    it("is idempotent", async () => {
      await migrateUp({ context: sequelize.getQueryInterface() });
      expect(await grantsFor("whatsapp:send")).toEqual(["Administrator", "Cashier"]);
      const [{ n }] = await sequelize.query("SELECT COUNT(*) AS n FROM PERMISSIONS WHERE permission_code = 'whatsapp:send'", { type: "SELECT" });
      expect(Number(n)).toBe(1);
    });

    it("the tables it creates work with the models", async () => {
      const row = await models.WhatsappMessageLog.create({ template_key: "receipt", to_phone: "94771234567", body: "x" });
      expect(row.status).toBe("opened");
      await models.WhatsappTemplate.create({ template_key: "receipt", language: "en", body: "x" });
      await expect(models.WhatsappTemplate.create({ template_key: "receipt", language: "en", body: "y" })).rejects.toThrow(); // unique index from the migration
    });

    it("stores Sinhala and emoji even when the database default charset is latin1", async () => {
      // the migration pins utf8mb4 on its own tables; trusting the database default would break on a latin1 server
      const u = new URL(DB_URL);
      const dbName = `${sequelize.config.database}_latin1`;
      await sequelize.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      await sequelize.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET latin1`);
      u.pathname = `/${dbName}`;
      const other = new Sequelize(u.toString(), { dialect: "mysql", logging: false });
      try {
        const otherModels = initTenantModels(other);
        await other.query("SET FOREIGN_KEY_CHECKS = 0");
        await other.sync({ force: true });
        await other.query("SET FOREIGN_KEY_CHECKS = 1");
        await other.query("DROP TABLE WHATSAPP_MESSAGE_LOGS");
        await other.query("DROP TABLE WHATSAPP_TEMPLATES");
        await other.query("ALTER TABLE CUSTOMERS DROP COLUMN whatsapp_opt_out");
        await migrateUp({ context: other.getQueryInterface() });
        const text = "ඉන්වොයිසිය ස්තූතියි 👋";
        await otherModels.WhatsappMessageLog.create({ template_key: "receipt", to_phone: "9477", body: text });
        expect((await otherModels.WhatsappMessageLog.findOne()).body).toBe(text);
      } finally {
        await other.close();
        await sequelize.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      }
    });

    it("down removes everything it added", async () => {
      await migrateDown({ context: sequelize.getQueryInterface() });
      const tables = await showTables();
      expect(tables).not.toContain("WHATSAPP_MESSAGE_LOGS");
      expect(tables).not.toContain("WHATSAPP_TEMPLATES");
      expect((await sequelize.getQueryInterface().describeTable("CUSTOMERS")).whatsapp_opt_out).toBeUndefined();
      expect(await grantsFor("whatsapp:send")).toEqual([]);
    });
  });
});
