import { describe, it, expect, beforeEach } from "vitest";
import { Op } from "sequelize";
import * as wa from "../../src/services/whatsappService.js";

// ─── a tiny in-memory stand-in for the tenant models ─────────────────────────

const asArray = (v) => (Array.isArray(v) ? v : [v]);
const matches = (row, where = {}) =>
  Object.entries(where).every(([k, cond]) => {
    if (k === Op.or) return cond.some((w) => matches(row, w));
    if (cond && typeof cond === "object" && !Array.isArray(cond) && cond[Op.gte] !== undefined) return new Date(row[k]) >= cond[Op.gte];
    if (Array.isArray(cond)) return cond.includes(row[k]);
    return row[k] == cond; // eslint-disable-line eqeqeq
  });
const newest = (rows) => [...rows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.log_id - a.log_id);

function makeModels(seed = {}) {
  const db = {
    invoices: seed.invoices || [],
    customers: seed.customers || [],
    lines: seed.lines || [],
    payments: seed.payments || [],
    templates: seed.templates || [],
    logs: seed.logs || [],
    config: seed.config === undefined ? { business_display_name: "GearCo", timezone: "Asia/Colombo", custom_settings: null } : seed.config,
    returnRows: seed.returnRows || [],
    paymentRows: seed.paymentRows || [],
  };
  let logId = 1000;
  // like a Sequelize instance: update() changes both the stored row and the instance handed out
  const withUpdate = (row) => {
    if (!row) return row;
    const instance = { ...row };
    instance.update = async (patch) => {
      Object.assign(row, patch);
      Object.assign(instance, patch);
      return instance;
    };
    return instance;
  };

  const models = {
    _db: db,
    // stands in for the three "returns" statements (one per section) and the "money owed" one
    sequelize: {
      query: async (sql, opts = {}) => {
        if (!sql.includes("INVOICE_LINES")) return db.paymentRows;
        const r = opts.replacements || {};
        const cap = Number(/LIMIT (\d+)/.exec(sql)[1]);
        let rows;
        if (sql.includes("< :today")) rows = db.returnRows.filter((x) => x.due_date < r.today);
        else if (sql.includes("= :today")) rows = db.returnRows.filter((x) => x.due_date === r.today);
        else if (sql.includes("= :tomorrow")) rows = db.returnRows.filter((x) => x.due_date === r.tomorrow);
        else throw new Error(`unexpected returns SQL: ${sql}`);
        return rows.slice(0, cap);
      },
    },
    Invoice: { findByPk: async (id) => db.invoices.find((i) => i.invoice_id == id) || null },
    InvoiceLine: { findAll: async ({ where }) => db.lines.filter((l) => asArray(where.invoice_id).includes(l.invoice_id)) },
    Payment: { findAll: async ({ where }) => db.payments.filter((p) => p.invoice_id == where.invoice_id && p.is_voided === where.is_voided) },
    Equipment: {},
    Customer: {
      findByPk: async (id) => withUpdate(db.customers.find((c) => c.customer_id == id) || null),
      findAll: async ({ where }) => db.customers.filter((c) => asArray(where.customer_id).includes(c.customer_id)),
    },
    TenantConfig: {
      findOne: async () => (db.config ? { ...db.config, update: async (p) => Object.assign(db.config, p) } : null),
      create: async (p) => {
        db.config = { timezone: "Asia/Colombo", ...p };
        return { ...db.config, update: async (x) => Object.assign(db.config, x) };
      },
    },
    WhatsappTemplate: {
      findAll: async () => db.templates,
      findOne: async ({ where }) => withUpdate(db.templates.find((t) => matches(t, where)) || null),
      create: async (p) => {
        db.templates.push({ ...p });
        return p;
      },
      destroy: async ({ where }) => {
        db.templates = db.templates.filter((t) => !matches(t, where));
      },
    },
    WhatsappMessageLog: {
      findOne: async ({ where }) => newest(db.logs.filter((l) => matches(l, where)))[0] || null,
      findAll: async ({ where }) => newest(db.logs.filter((l) => matches(l, where))),
      findByPk: async (id) => withUpdate(db.logs.find((l) => l.log_id == id) || null),
      create: async (p) => {
        const row = { log_id: ++logId, createdAt: new Date(), ...p };
        db.logs.push(row);
        return row;
      },
      findAndCountAll: async ({ where, limit, offset }) => {
        const all = newest(db.logs.filter((l) => matches(l, where)));
        return { count: all.length, rows: all.slice(offset, offset + limit) };
      },
    },
  };
  return models;
}

const cust = (over = {}) => ({
  customer_id: 7,
  customer_type: "Individual",
  first_name: "Nimal",
  last_name: "Perera",
  company_name: null,
  phone_number: "077 123 4567",
  whatsapp_opt_out: false,
  ...over,
});
const eq = (name, serial, si = null) => ({ equipment_name: name, equipment_name_si: si, serial_number: serial });
const line = (over = {}) => ({
  invoice_id: 50,
  borrow_quantity: 2,
  good_returned_qty: 0,
  defective_returned_qty: 0,
  expected_return_date: "2026-10-28",
  track_overdue: true,
  Equipment: eq("Hammer Drill", "EQ-0001", "හැමර් ඩ්‍රිල්"),
  ...over,
});
const inv = (over = {}) => ({
  invoice_id: 50,
  customer_id: 7,
  total_amount: "12500.00",
  advance_paid: "0.00",
  issued_date: new Date("2026-10-26T05:00:00Z"),
  status: "Active",
  ...over,
});
const baseSeed = (over = {}) => ({
  invoices: [inv()],
  customers: [cust()],
  lines: [line(), line({ borrow_quantity: 1, Equipment: eq("Step Ladder", "EQ-0014") })],
  payments: [{ invoice_id: 50, payment_amount: "5000.00", is_voided: false }],
  ...over,
});
const textOf = (link) => decodeURIComponent(link.split("?text=")[1] || "");

// ─── pure helpers ────────────────────────────────────────────────────────────

describe("formatting helpers", () => {
  it("formats money without trailing .00 and keeps real cents", () => {
    expect(wa.formatMoney(12500)).toBe("Rs. 12,500");
    expect(wa.formatMoney("12500.00")).toBe("Rs. 12,500");
    expect(wa.formatMoney(1234.5)).toBe("Rs. 1,234.50");
    expect(wa.formatMoney(null)).toBe("Rs. 0");
  });

  it("formats dates: DATEONLY strings as-is, Dates in the shop timezone", () => {
    expect(wa.formatDate("2026-10-28")).toBe("28 Oct 2026");
    expect(wa.formatDate("2026-01-05")).toBe("5 Jan 2026");
    // 20:00 UTC on the 25th is already the 26th in Colombo (UTC+5:30)
    expect(wa.formatDate(new Date("2026-10-25T20:00:00Z"), "Asia/Colombo")).toBe("26 Oct 2026");
    expect(wa.formatDate(null)).toBe("");
    expect(wa.formatDate("garbage-date")).toBe("");
  });

  it("works out 'today' in the shop's timezone, not the server's", () => {
    const lateEvening = new Date("2026-10-25T20:00:00Z");
    expect(wa.todayInTz("Asia/Colombo", lateEvening)).toBe("2026-10-26");
    expect(wa.todayInTz("UTC", lateEvening)).toBe("2026-10-25");
  });

  it("does calendar arithmetic across month and year ends", () => {
    expect(wa.addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(wa.addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(wa.addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(wa.daysBetween("2026-10-20", "2026-10-26")).toBe(6);
    expect(wa.daysBetween("2026-10-26", "2026-10-20")).toBe(-6);
    expect(wa.daysBetween("2026-12-30", "2027-01-02")).toBe(3);
  });

  it("names customers: person, business, and fallbacks", () => {
    expect(wa.customerDisplayName(cust())).toBe("Nimal Perera");
    expect(wa.customerDisplayName(cust({ customer_type: "Business", company_name: "ABC Builders" }))).toBe("ABC Builders");
    expect(wa.customerDisplayName(cust({ customer_type: "Business", company_name: null }))).toBe("Nimal Perera");
    expect(wa.customerDisplayName(null)).toBe("");
  });

  it("lists machines with number, Sinhala names, pending-only mode and a +N more cap", () => {
    const lines = [line(), line({ borrow_quantity: 3, good_returned_qty: 1, Equipment: eq("Ladder", "EQ-2") })];
    expect(wa.buildItemsList(lines)).toBe("• 2 × Hammer Drill (EQ-0001)\n• 3 × Ladder (EQ-2)");
    expect(wa.buildItemsList(lines, { language: "si" })).toContain("හැමර් ඩ්‍රිල් (EQ-0001)");
    expect(wa.buildItemsList(lines, { pendingOnly: true })).toBe("• 2 × Hammer Drill (EQ-0001)\n• 2 × Ladder (EQ-2)");
    const fullyReturned = [line({ good_returned_qty: 1, defective_returned_qty: 1 })];
    expect(wa.buildItemsList(fullyReturned, { pendingOnly: true })).toBe("");
    const many = Array.from({ length: 9 }, (_, i) => line({ Equipment: eq(`M${i}`, `S${i}`) }));
    const out = wa.buildItemsList(many);
    expect(out.split("\n")).toHaveLength(7);
    expect(out.endsWith("… +3 more")).toBe(true);
    expect(wa.buildItemsList(many, { language: "si" }).endsWith("තවත් 3ක්")).toBe(true);
  });
});

// ─── compose ─────────────────────────────────────────────────────────────────

describe("composeMessage", () => {
  it("builds a receipt with the real invoice figures and a wa.me link", async () => {
    const m = makeModels(baseSeed({ config: { business_display_name: "GearCo", timezone: "Asia/Colombo", custom_settings: { whatsapp: { shop_phone: "011 555 0000" } } } }));
    const r = await wa.composeMessage(m, { template_key: "receipt", invoice_id: 50 });
    expect(r.language).toBe("en");
    expect(r.body).toContain("Hello Nimal Perera");
    expect(r.body).toContain("GearCo");
    expect(r.body).toContain("INV-50");
    expect(r.body).toContain("26 Oct 2026");
    expect(r.body).toContain("• 2 × Hammer Drill (EQ-0001)");
    expect(r.body).toContain("Total: Rs. 12,500");
    expect(r.body).toContain("Paid: Rs. 5,000");
    expect(r.body).toContain("Balance: Rs. 7,500");
    expect(r.body).toContain("Call us: 011 555 0000");
    expect(r.body).not.toContain("Advance"); // no advance → that line is dropped
    expect(r.to).toMatchObject({ digits: "94771234567", valid: true, kind: "mobile" });
    expect(r.link.startsWith("https://wa.me/94771234567?text=")).toBe(true);
    expect(textOf(r.link)).toBe(r.body);
    expect(r.invoice).toMatchObject({ number: "INV-50", balance: 7500 });
    expect(r.warnings).toEqual([]);
  });

  it("shows the advance line only when there is one, and ignores voided payments", async () => {
    const m = makeModels(
      baseSeed({
        invoices: [inv({ advance_paid: "3000.00" })],
        payments: [
          { invoice_id: 50, payment_amount: "5000.00", is_voided: false },
          { invoice_id: 50, payment_amount: "9000.00", is_voided: true },
        ],
      }),
    );
    const r = await wa.composeMessage(m, { template_key: "receipt", invoice_id: 50 });
    expect(r.body).toContain("Advance: Rs. 3,000");
    expect(r.body).toContain("Balance: Rs. 7,500");
  });

  it("uses the shop's own template when one is saved", async () => {
    const m = makeModels(baseSeed({ templates: [{ template_key: "receipt", language: "en", body: "Receipt {{invoice_number}} for {{customer_name}}: {{balance}} due" }] }));
    const r = await wa.composeMessage(m, { template_key: "receipt", invoice_id: 50 });
    expect(r.body).toBe("Receipt INV-50 for Nimal Perera: Rs. 7,500 due");
  });

  describe("language", () => {
    it("explicit language wins, then the customer's last language, then the shop default", async () => {
      const logs = [{ log_id: 1, customer_id: 7, invoice_id: 50, template_key: "receipt", language: "si", createdAt: new Date() }];
      const withLog = makeModels(baseSeed({ logs }));
      expect((await wa.composeMessage(withLog, { template_key: "receipt", invoice_id: 50 })).language).toBe("si");
      expect((await wa.composeMessage(withLog, { template_key: "receipt", invoice_id: 50, language: "en" })).language).toBe("en");

      const shopSi = makeModels(baseSeed({ config: { business_display_name: "GearCo", timezone: "Asia/Colombo", custom_settings: { whatsapp: { default_language: "si" } } } }));
      expect((await wa.composeMessage(shopSi, { template_key: "receipt", invoice_id: 50 })).language).toBe("si");

      const old = makeModels(baseSeed({ logs: [{ ...logs[0], createdAt: new Date(Date.now() - 90 * 86400000) }] }));
      expect((await wa.composeMessage(old, { template_key: "receipt", invoice_id: 50 })).language).toBe("en"); // memory expired
    });

    it("renders Sinhala wording and Sinhala machine names", async () => {
      const r = await wa.composeMessage(makeModels(baseSeed()), { template_key: "receipt", invoice_id: 50, language: "si" });
      expect(r.body).toContain("ඉන්වොයිසිය INV-50");
      expect(r.body).toContain("හැමර් ඩ්‍රිල්");
      expect(textOf(r.link)).toBe(r.body);
    });

    it("rejects an unsupported language", async () => {
      await expect(wa.composeMessage(makeModels(baseSeed()), { template_key: "receipt", invoice_id: 50, language: "ta" })).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe("return reminders", () => {
    const seedDue = (due, over = {}) => baseSeed({ lines: [line({ expected_return_date: due }), line({ expected_return_date: "2026-12-01", Equipment: eq("Ladder", "EQ-2") })], ...over });

    it("talks about the earliest due date among machines still out", async () => {
      const r = await wa.composeMessage(makeModels(seedDue("2026-10-20")), { template_key: "overdue_return", invoice_id: 50 });
      expect(r.body).toContain("20 Oct 2026");
      expect(r.body).toMatch(/\(\d+ day\(s\) ago\)/);
      expect(r.warnings).not.toContain("nothing_to_return");
    });

    it("ignores returned lines and untracked lines when picking the date", async () => {
      const seed = baseSeed({
        lines: [
          line({ expected_return_date: "2026-10-01", good_returned_qty: 2 }), // already back
          line({ expected_return_date: "2026-10-02", track_overdue: false, Equipment: eq("Saw", "EQ-3") }), // not tracked
          line({ expected_return_date: "2026-11-05", Equipment: eq("Ladder", "EQ-2") }),
        ],
      });
      const r = await wa.composeMessage(makeModels(seed), { template_key: "return_due_today", invoice_id: 50 });
      expect(r.body).toContain("5 Nov 2026");
      expect(r.body).toContain("Ladder");
      expect(r.body).not.toContain("Hammer Drill"); // returned, so not listed
    });

    it("warns when there is nothing left to return", async () => {
      const seed = baseSeed({ lines: [line({ good_returned_qty: 2 })] });
      const r = await wa.composeMessage(makeModels(seed), { template_key: "return_due_today", invoice_id: 50 });
      expect(r.warnings).toContain("nothing_to_return");
    });
  });

  describe("warnings", () => {
    it("no phone / landline / invalid number", async () => {
      for (const [phone, warning] of [["", "no_phone"], ["011 234 5678", "landline"], ["12345", "invalid_phone"]]) {
        const m = makeModels(baseSeed({ customers: [cust({ phone_number: phone })] }));
        const r = await wa.composeMessage(m, { template_key: "receipt", invoice_id: 50 });
        expect(r.warnings).toContain(warning);
        // still hands back a link — without a number WhatsApp opens its contact picker
        expect(r.link.startsWith("https://wa.me/?text=")).toBe(true);
      }
    });

    it("picks the mobile out of a multi-number field", async () => {
      const m = makeModels(baseSeed({ customers: [cust({ phone_number: "011 2345678 / 071 333 4444" })] }));
      const r = await wa.composeMessage(m, { template_key: "receipt", invoice_id: 50 });
      expect(r.to.digits).toBe("94713334444");
      expect(r.warnings).toEqual([]);
    });

    it("opted-out customers are flagged", async () => {
      const m = makeModels(baseSeed({ customers: [cust({ whatsapp_opt_out: true })] }));
      const r = await wa.composeMessage(m, { template_key: "receipt", invoice_id: 50 });
      expect(r.warnings).toContain("opted_out");
      expect(r.customer.opted_out).toBe(true);
    });

    it("messaged recently (same type, same invoice, within 12h)", async () => {
      const recent = { log_id: 1, customer_id: 7, invoice_id: 50, template_key: "payment_reminder", language: "en", status: "opened", createdAt: new Date(Date.now() - 3600 * 1000) };
      const r1 = await wa.composeMessage(makeModels(baseSeed({ logs: [recent] })), { template_key: "payment_reminder", invoice_id: 50 });
      expect(r1.warnings).toContain("messaged_recently");
      expect(r1.last_message).toMatchObject({ template_key: "payment_reminder", status: "opened" });
      // a different message type does not trigger it
      const r2 = await wa.composeMessage(makeModels(baseSeed({ logs: [recent] })), { template_key: "receipt", invoice_id: 50 });
      expect(r2.warnings).not.toContain("messaged_recently");
      // an old one does not either
      const old = { ...recent, createdAt: new Date(Date.now() - 30 * 3600 * 1000) };
      const r3 = await wa.composeMessage(makeModels(baseSeed({ logs: [old] })), { template_key: "payment_reminder", invoice_id: 50 });
      expect(r3.warnings).not.toContain("messaged_recently");
    });

    it("a payment reminder on a settled invoice is flagged", async () => {
      const m = makeModels(baseSeed({ payments: [{ invoice_id: 50, payment_amount: "12500.00", is_voided: false }] }));
      const r = await wa.composeMessage(m, { template_key: "payment_reminder", invoice_id: 50 });
      expect(r.warnings).toContain("no_balance");
    });

    it("flags a message too long to send as a link", async () => {
      const m = makeModels(baseSeed({ customers: [cust()] }));
      const r = await wa.composeMessage(m, { template_key: "custom", customer_id: 7, custom_text: "x".repeat(7000) });
      expect(r.warnings).toContain("too_long");
    });
  });

  describe("custom messages", () => {
    it("uses exactly what staff typed (no template mangling) and needs no invoice", async () => {
      const r = await wa.composeMessage(makeModels(baseSeed()), { template_key: "custom", customer_id: 7, custom_text: "  Your drill is ready {{total}} \n pick up  " });
      expect(r.body).toBe("Your drill is ready {{total}} \n pick up");
      expect(r.invoice).toBeNull();
      expect(r.to.digits).toBe("94771234567");
    });

    it("falls back to the greeting template when nothing was typed", async () => {
      const r = await wa.composeMessage(makeModels(baseSeed()), { template_key: "custom", customer_id: 7 });
      expect(r.body).toBe("Hello Nimal Perera,");
    });
  });

  describe("validation", () => {
    it("rejects unknown types, missing targets, and unknown records", async () => {
      const m = makeModels(baseSeed());
      await expect(wa.composeMessage(m, { template_key: "nope", invoice_id: 50 })).rejects.toMatchObject({ statusCode: 400 });
      await expect(wa.composeMessage(m, { template_key: "receipt" })).rejects.toMatchObject({ statusCode: 400 });
      await expect(wa.composeMessage(m, { template_key: "custom" })).rejects.toMatchObject({ statusCode: 400 });
      await expect(wa.composeMessage(m, { template_key: "receipt", invoice_id: 999 })).rejects.toMatchObject({ statusCode: 404 });
      await expect(wa.composeMessage(m, { template_key: "custom", customer_id: 999 })).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});

// ─── templates & settings ────────────────────────────────────────────────────

describe("templates", () => {
  it("lists every type in both languages with default and custom flags", async () => {
    const m = makeModels({ templates: [{ template_key: "receipt", language: "si", body: "සිංහල {{customer_name}}" }] });
    const t = await wa.getTemplates(m);
    expect(t.keys.map((k) => k.key)).toContain("receipt");
    expect(t.templates.receipt.si).toMatchObject({ body: "සිංහල {{customer_name}}", is_custom: true });
    expect(t.templates.receipt.en.is_custom).toBe(false);
    expect(t.templates.receipt.en.body).toBe(t.templates.receipt.en.default_body);
    expect(t.placeholders).toContain("customer_name");
    expect(t.samples.en.customer_name).toBeTruthy();
  });

  it("creates then updates a template (one row per type + language)", async () => {
    const m = makeModels();
    await wa.saveTemplate(m, { key: "receipt", language: "en", body: "First {{invoice_number}}", userId: 3 });
    await wa.saveTemplate(m, { key: "receipt", language: "en", body: "Second {{invoice_number}}", userId: 4 });
    expect(m._db.templates).toHaveLength(1);
    expect(m._db.templates[0]).toMatchObject({ body: "Second {{invoice_number}}", updated_by_user_id: 4 });
  });

  it("normalises Windows line endings", async () => {
    const m = makeModels();
    const r = await wa.saveTemplate(m, { key: "custom", language: "en", body: "a\r\nb" });
    expect(r.body).toBe("a\nb");
  });

  it("refuses empty, oversized, unknown-placeholder and unknown-type templates", async () => {
    const m = makeModels();
    await expect(wa.saveTemplate(m, { key: "receipt", language: "en", body: "   " })).rejects.toMatchObject({ statusCode: 400 });
    await expect(wa.saveTemplate(m, { key: "receipt", language: "en", body: "x".repeat(1501) })).rejects.toMatchObject({ statusCode: 400 });
    await expect(wa.saveTemplate(m, { key: "receipt", language: "en", body: "Hi {{nickname}}" })).rejects.toThrow(/\{\{nickname\}\}/);
    await expect(wa.saveTemplate(m, { key: "bogus", language: "en", body: "hi" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(wa.saveTemplate(m, { key: "receipt", language: "xx", body: "hi" })).rejects.toMatchObject({ statusCode: 400 });
    expect(m._db.templates).toHaveLength(0);
  });

  it("reset removes the override and returns the built-in wording", async () => {
    const m = makeModels({ templates: [{ template_key: "receipt", language: "en", body: "mine" }] });
    const r = await wa.resetTemplate(m, { key: "receipt", language: "en" });
    expect(m._db.templates).toHaveLength(0);
    expect(r.is_custom).toBe(false);
    expect(r.body).toContain("Thank you for choosing");
  });
});

describe("settings", () => {
  it("reads the shop name, phone and language (phone falls back to legacy config keys)", async () => {
    const m = makeModels({ config: { business_display_name: "GearCo", custom_settings: { contact_phone: "011 111 1111" } } });
    expect(await wa.getSettings(m)).toEqual({ shop_name: "GearCo", shop_phone: "011 111 1111", default_language: "en" });
  });

  it("updates inside custom_settings without disturbing other keys, even when the JSON column arrives as a string", async () => {
    const m = makeModels({ config: { business_display_name: "GearCo", custom_settings: JSON.stringify({ keep: "me", whatsapp: { default_language: "si" } }) } });
    const r = await wa.updateSettings(m, { shop_phone: " 077 999 8888 " });
    expect(r).toMatchObject({ shop_phone: "077 999 8888", default_language: "si" });
    expect(m._db.config.custom_settings.keep).toBe("me");
  });

  it("validates input and creates the config row if the tenant has none", async () => {
    const m = makeModels({ config: null });
    await expect(wa.updateSettings(m, { default_language: "fr" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(wa.updateSettings(m, { shop_phone: "1".repeat(31) })).rejects.toMatchObject({ statusCode: 400 });
    const r = await wa.updateSettings(m, { shop_phone: "0771112222", default_language: "si" });
    expect(r.default_language).toBe("si");
  });
});

// ─── log & opt-out ───────────────────────────────────────────────────────────

describe("message log", () => {
  it("records an opened chat with digits-only phone and the sender", async () => {
    const m = makeModels(baseSeed());
    const row = await wa.logMessage(m, { customer_id: 7, invoice_id: 50, template_key: "receipt", language: "si", to_phone: "+94 77 123 4567", body: "hi", userId: 9 });
    expect(row).toMatchObject({ to_phone: "94771234567", channel: "link", status: "opened", sent_by_user_id: 9, language: "si" });
    expect(m._db.logs).toHaveLength(1);
  });

  it("validates its input", async () => {
    const m = makeModels(baseSeed());
    const ok = { customer_id: 7, template_key: "receipt", to_phone: "94771234567", body: "hi" };
    await expect(wa.logMessage(m, { ...ok, template_key: "x" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(wa.logMessage(m, { ...ok, body: "  " })).rejects.toMatchObject({ statusCode: 400 });
    await expect(wa.logMessage(m, { ...ok, language: "zz" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("logs a chat opened without a number (staff picked the contact in WhatsApp)", async () => {
    const m = makeModels(baseSeed());
    const row = await wa.logMessage(m, { customer_id: 7, template_key: "receipt", to_phone: "", body: "hi" });
    expect(row.to_phone).toBe("");
  });

  it("refuses to log (and so to send) for an opted-out customer", async () => {
    const m = makeModels(baseSeed({ customers: [cust({ whatsapp_opt_out: true })] }));
    await expect(wa.logMessage(m, { customer_id: 7, template_key: "receipt", to_phone: "94771234567", body: "hi" })).rejects.toMatchObject({ statusCode: 409 });
    expect(m._db.logs).toHaveLength(0);
  });

  it("confirms a send, or 404s", async () => {
    const m = makeModels(baseSeed());
    const row = await wa.logMessage(m, { customer_id: 7, template_key: "receipt", to_phone: "94771234567", body: "hi" });
    expect((await wa.confirmSent(m, row.log_id)).status).toBe("sent");
    await expect(wa.confirmSent(m, 424242)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("lists newest first with customer names, filters, and a capped page size", async () => {
    const now = Date.now();
    const logs = [
      { log_id: 1, customer_id: 7, invoice_id: 50, template_key: "receipt", language: "en", to_phone: "94771234567", body: "a", status: "opened", createdAt: new Date(now - 3000) },
      { log_id: 2, customer_id: 8, invoice_id: 51, template_key: "payment_reminder", language: "si", to_phone: "94712223333", body: "b", status: "sent", createdAt: new Date(now - 1000) },
    ];
    const m = makeModels(baseSeed({ logs, customers: [cust(), cust({ customer_id: 8, first_name: "Kamal", last_name: "Silva" })] }));
    const all = await wa.listLog(m, {});
    expect(all.total).toBe(2);
    expect(all.entries.map((e) => e.log_id)).toEqual([2, 1]);
    expect(all.entries[0]).toMatchObject({ customer_name: "Kamal Silva", invoice_number: "INV-51", status: "sent" });
    expect((await wa.listLog(m, { customer_id: 7 })).entries).toHaveLength(1);
    expect((await wa.listLog(m, { template_key: "payment_reminder" })).entries[0].log_id).toBe(2);
    expect((await wa.listLog(m, { limit: 1 })).entries).toHaveLength(1);
    expect((await wa.listLog(m, { limit: 9999 })).entries).toHaveLength(2); // capped, not rejected
  });

  it("toggles opt-out (and 404s for a missing customer)", async () => {
    const m = makeModels(baseSeed());
    expect(await wa.setOptOut(m, 7, true)).toEqual({ customer_id: 7, opted_out: true });
    expect(m._db.customers[0].whatsapp_opt_out).toBe(true);
    expect((await wa.setOptOut(m, 7, false)).opted_out).toBe(false);
    await expect(wa.setOptOut(m, 999, true)).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─── the Today worklist ──────────────────────────────────────────────────────

describe("getWorklist", () => {
  // "now" = 26 Oct 2026, mid-morning in Colombo
  const NOW = new Date("2026-10-26T04:30:00Z");
  const ret = (invoice_id, customer_id, due_date, over = {}) => ({ invoice_id, customer_id, total_amount: "10000.00", advance_paid: "0.00", issued_date: new Date("2026-10-20T05:00:00Z"), due_date, ...over });

  const seed = (over = {}) => ({
    customers: [
      cust({ customer_id: 1, first_name: "Overdue", last_name: "Olu" }),
      cust({ customer_id: 2, first_name: "Today", last_name: "Tina", phone_number: "071 222 3333" }),
      cust({ customer_id: 3, first_name: "Tomorrow", last_name: "Tim", phone_number: "011 2345678" }),
      cust({ customer_id: 4, first_name: "Owes", last_name: "Oscar", phone_number: "078 444 5555" }),
      cust({ customer_id: 5, first_name: "Stale", last_name: "Sam", whatsapp_opt_out: true }),
    ],
    lines: [
      line({ invoice_id: 11, expected_return_date: "2026-10-20" }),
      line({ invoice_id: 12, expected_return_date: "2026-10-26", Equipment: eq("Ladder", "EQ-2") }),
      line({ invoice_id: 13, expected_return_date: "2026-10-27", Equipment: eq("Saw", "EQ-3") }),
      line({ invoice_id: 14, expected_return_date: "2026-10-01", good_returned_qty: 2, Equipment: eq("Mixer", "EQ-4") }),
      line({ invoice_id: 15, expected_return_date: "2026-10-22", Equipment: eq("Grinder", "EQ-5") }),
    ],
    returnRows: [ret(15, 5, "2026-10-22"), ret(12, 2, "2026-10-26"), ret(11, 1, "2026-10-20"), ret(13, 3, "2026-10-27")],
    paymentRows: [{ ...ret(14, 4, null), total_paid: "4000.00", due_date: undefined }],
    config: { business_display_name: "GearCo", timezone: "Asia/Colombo", custom_settings: { whatsapp: { shop_phone: "011 555 0000" } } },
    ...over,
  });

  it("sorts every invoice into the right section with the right wording", async () => {
    const w = await wa.getWorklist(makeModels(seed()), { now: NOW });
    expect(w.today).toBe("2026-10-26");
    expect(w.summary).toMatchObject({ overdue_returns: 2, returns_due_today: 1, returns_due_tomorrow: 1, payments_pending: 1, balance_pending: 6000 });

    const [first, second] = w.sections.overdue_returns;
    expect(first).toMatchObject({ invoice_id: 11, days_late: 6, template_key: "overdue_return" }); // most overdue first
    expect(second).toMatchObject({ invoice_id: 15, days_late: 4 });
    expect(w.sections.returns_due_today[0]).toMatchObject({ invoice_id: 12, template_key: "return_due_today", days_late: 0 });
    expect(w.sections.returns_due_tomorrow[0]).toMatchObject({ invoice_id: 13, template_key: "return_due_tomorrow" });
    expect(w.sections.payments_pending[0]).toMatchObject({ invoice_id: 14, template_key: "payment_reminder", balance: 6000 });
  });

  it("composes ready-to-send messages with real details", async () => {
    const w = await wa.getWorklist(makeModels(seed()), { now: NOW });
    const overdue = w.sections.overdue_returns[0];
    expect(overdue.body).toContain("Overdue Olu");
    expect(overdue.body).toContain("20 Oct 2026");
    expect(overdue.body).toContain("6 day(s) ago");
    expect(overdue.body).toContain("• 2 × Hammer Drill (EQ-0001)");
    expect(overdue.body).toContain("011 555 0000");
    expect(textOf(overdue.link)).toBe(overdue.body);
    expect(overdue.link.startsWith("https://wa.me/94771234567?text=")).toBe(true);

    const pay = w.sections.payments_pending[0];
    expect(pay.body).toContain("Rs. 6,000");
    expect(pay.body).toContain("Rs. 4,000");
    expect(pay.customer.phone.digits).toBe("94784445555");
  });

  it("does not list machines that are already back, and shows pending quantities only", async () => {
    const w = await wa.getWorklist(makeModels(seed()), { now: NOW });
    const all = Object.values(w.sections).flat();
    expect(all.find((i) => i.invoice_id === 14).items).toContain("Mixer"); // payment row lists the whole order
    expect(w.sections.returns_due_today[0].pending_units).toBe(2);
  });

  it("flags rows that cannot be messaged (landline, opted out)", async () => {
    const w = await wa.getWorklist(makeModels(seed()), { now: NOW });
    expect(w.sections.returns_due_tomorrow[0].warnings).toContain("landline");
    const optedOut = w.sections.overdue_returns.find((i) => i.invoice_id === 15);
    expect(optedOut.customer.opted_out).toBe(true);
    expect(optedOut.warnings).toContain("opted_out");
  });

  it("remembers each customer's language and the last message sent for the invoice", async () => {
    const logs = [
      { log_id: 1, customer_id: 1, invoice_id: 11, template_key: "overdue_return", language: "si", status: "sent", createdAt: new Date(NOW.getTime() - 2 * 3600 * 1000) },
    ];
    const w = await wa.getWorklist(makeModels(seed({ logs })), { now: NOW });
    const row = w.sections.overdue_returns.find((i) => i.invoice_id === 11);
    expect(row.language).toBe("si");
    expect(row.body).toContain("ඉන්වොයිසිය INV-11");
    expect(row.last_message).toMatchObject({ template_key: "overdue_return", status: "sent" });
    expect(row.warnings).toContain("messaged_recently");
    // others stay on the shop default
    expect(w.sections.returns_due_today[0].language).toBe("en");
  });

  it("an explicit language overrides memory", async () => {
    const logs = [{ log_id: 1, customer_id: 1, invoice_id: 11, template_key: "overdue_return", language: "si", status: "sent", createdAt: NOW }];
    const w = await wa.getWorklist(makeModels(seed({ logs })), { now: NOW, language: "en" });
    expect(w.sections.overdue_returns.find((i) => i.invoice_id === 11).language).toBe("en");
    await expect(wa.getWorklist(makeModels(seed()), { now: NOW, language: "ta" })).rejects.toMatchObject({ statusCode: 400 });
  });

  describe("many invoices", () => {
    const bulk = (n, due, startId) => Array.from({ length: n }, (_, i) => ret(startId + i, 1, due));

    it("a pile of old overdue invoices never crowds out today and tomorrow", async () => {
      const m = makeModels(seed({ returnRows: [...bulk(350, "2026-08-01", 1000), ret(12, 2, "2026-10-26"), ret(13, 3, "2026-10-27")], paymentRows: [] }));
      const w = await wa.getWorklist(m, { now: NOW });
      expect(w.sections.returns_due_today.map((i) => i.invoice_id)).toEqual([12]);
      expect(w.sections.returns_due_tomorrow.map((i) => i.invoice_id)).toEqual([13]);
      expect(w.sections.overdue_returns).toHaveLength(300);
      expect(w.truncated).toEqual({ overdue_returns: true, returns_due_today: false, returns_due_tomorrow: false, payments_pending: false });
    });

    it("exactly at the cap is not reported as truncated", async () => {
      const m = makeModels(seed({ returnRows: bulk(300, "2026-08-01", 1000), paymentRows: [] }));
      const w = await wa.getWorklist(m, { now: NOW });
      expect(w.sections.overdue_returns).toHaveLength(300);
      expect(w.truncated.overdue_returns).toBe(false);
    });

    it("caps the money-owed list on its own", async () => {
      const owed = Array.from({ length: 320 }, (_, i) => ({ ...ret(2000 + i, 4, null), total_paid: "0", due_date: undefined }));
      const w = await wa.getWorklist(makeModels(seed({ returnRows: [], paymentRows: owed })), { now: NOW });
      expect(w.sections.payments_pending).toHaveLength(300);
      expect(w.truncated.payments_pending).toBe(true);
    });
  });

  it("is empty — not an error — when nothing needs chasing", async () => {
    const w = await wa.getWorklist(makeModels(seed({ returnRows: [], paymentRows: [] })), { now: NOW });
    expect(w.summary).toEqual({ overdue_returns: 0, returns_due_today: 0, returns_due_tomorrow: 0, payments_pending: 0, balance_pending: 0 });
    expect(Object.values(w.sections).every((s) => s.length === 0)).toBe(true);
  });

  it("uses the shop's timezone to decide what 'today' is", async () => {
    // 20:00 UTC on the 25th is the 26th in Colombo, so a 26th due date is "due today", not tomorrow
    const lateEvening = new Date("2026-10-25T20:00:00Z");
    const w = await wa.getWorklist(makeModels(seed({ returnRows: [ret(12, 2, "2026-10-26")] })), { now: lateEvening });
    expect(w.today).toBe("2026-10-26");
    expect(w.sections.returns_due_today).toHaveLength(1);
  });

  it("honours a customised template in the worklist too", async () => {
    const templates = [{ template_key: "overdue_return", language: "en", body: "LATE {{invoice_number}} {{days_late}}d" }];
    const w = await wa.getWorklist(makeModels(seed({ templates })), { now: NOW });
    expect(w.sections.overdue_returns[0].body).toBe("LATE INV-11 6d");
  });
});
