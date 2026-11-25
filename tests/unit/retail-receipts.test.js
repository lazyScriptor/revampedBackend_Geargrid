import { describe, expect, it, vi } from "vitest";
import { makeSalesHarness, assertSavable } from "../helpers/retailHarness.js";
import { createDispatchInvoice } from "../../src/services/invoiceService.js";
import { returnSaleLines, listSaleReturns, getRetailSettings, updateRetailSettings, mergeRetailSettings } from "../../src/modules/retail/index.js";
import { buildVars, buildItemsList, buildItemsSoldList, composeMessage, formatMoney } from "../../src/services/whatsappService.js";
import { PLACEHOLDERS, SAMPLE_VARS, DEFAULT_TEMPLATES, LANGUAGES } from "../../src/utils/whatsappTemplates.js";
import { recordPrintLog, snapshotSaleLines } from "../../src/services/invoicePrintLogService.js";
import { PRINT_DOC_TYPES } from "../../src/models/InvoicePrintLog.js";
import { ensureEnumValues, parseEnumValues } from "../../migrations/lib/schemaGuards.js";
import * as printDocTypesMigration from "../../migrations/tenant/20261124110000-print-doc-types.js";
import invoiceRoutes from "../../src/routes/invoiceRoutes.js";

vi.mock("../../src/services/notificationService.js", () => ({ createNotification: vi.fn() }));
vi.mock("../../src/services/accrualService.js", () => ({ refreshAccruals: vi.fn(async () => ({})), freshAccruals: (req, res, next) => next() }));
vi.mock("../../src/services/pushEventService.js", () => ({ notifyEvent: vi.fn(async () => ({ sent: 0 })) }));

const machine = (over = {}) => ({
  equipment_id: 1,
  borrow_date: "2026-11-20",
  expected_return_date: "2026-11-21",
  locked_base_price: 1000,
  locked_minimum_days: 1,
  locked_extra_daily_rate: 500,
  borrow_quantity: 1,
  ...over,
});

const makeShop = () => {
  const h = makeSalesHarness({
    rollback: true,
    equipment: [{ equipment_id: 1, equipment_name: "Breaker", available_qty: 3, total_owned_qty: 3 }],
    products: [
      { product_id: 1, code: "H1", name: "Hammer", sell_price: 400, avg_cost: 250 },
      { product_id: 2, code: "N1", name: 'Tolsen Nail 2"', sell_price: 20, avg_cost: 10 },
    ],
    units: [{ unit_id: 11, product_id: 2, unit_name: "box", factor: 10, sell_price: 180 }],
    levels: [
      { product_id: 1, warehouse_id: 1, qty_on_hand: 20 },
      { product_id: 2, warehouse_id: 1, qty_on_hand: 200 },
    ],
    customers: [
      { customer_id: 5, first_name: "Ali" },
      { customer_id: 9, first_name: "Walk-in", is_walk_in: true },
    ],
  });
  const templates = [];
  h.templates = templates;
  h.models.WhatsappTemplate = { findAll: vi.fn(async () => templates) };
  h.models.WhatsappMessageLog = { findOne: vi.fn(async () => null), findAll: vi.fn(async () => []) };
  h.models.User.findAll = vi.fn(async () => [{ user_id: 1, first_name: "Nimal", last_name: "Perera", username: "nimal" }]);
  // the bill read the print log does: the bill with its goods and its cashier
  const baseFind = h.models.Invoice.findByPk;
  h.models.Invoice.findByPk = vi.fn(async (id, opts) => {
    const inv = await baseFind(id, opts);
    if (inv && opts?.include) {
      inv.SaleLines = h.saleLineRecords.filter((l) => Number(l.invoice_id) === Number(id));
      inv.User = { user_id: 1, first_name: "Nimal", last_name: "Perera", username: "nimal" };
    }
    return inv;
  });
  return h;
};

const saleBill = (h, over = {}) =>
  createDispatchInvoice(
    h.models,
    { customer_id: 5, sale_items: [{ product_id: 1, qty: 3 }, { product_id: 2, qty: 2, unit_id: 11 }], fees: {}, payment: { amount: 1560 }, effectivePermissions: ["retail:add_unlisted"], ...over },
    1,
  );
const mixedBill = (h, over = {}) =>
  createDispatchInvoice(
    h.models,
    {
      customer_id: 5,
      items: [machine()],
      sale_items: [{ product_id: 1, qty: 2 }, { product_id: 2, qty: 1, unit_id: 11 }],
      fees: { transport: 0, discount: 0, advance: 500 },
      effectivePermissions: ["retail:add_unlisted"],
      ...over,
    },
    1,
  );
const rentalBill = (h) => createDispatchInvoice(h.models, { customer_id: 5, items: [machine()], fees: { transport: 0, discount: 0, advance: 0 } }, 1);
const ret = (h, id, lines, extra = {}) =>
  returnSaleLines(h.models, id, { lines, settlement: { mode: "refund" }, userId: 1, effectivePermissions: ["retail:return"], ...extra });

const withEquipmentNames = (h) => {
  for (const l of h.invoiceLineRecords) l.Equipment = { equipment_name: "Breaker", equipment_name_si: "බ්‍රේකරය" };
};

const ALL_VARS_TEMPLATE = "ITEMS:\n{{items}}\nSOLD:\n{{items_sold}}\nCOUNT {{item_count}}\nSALE {{sale_total}}\nRENT {{rent_total}}\nTOTAL {{total}}";
const setTemplate = (h, body, language = "en") => h.templates.push({ template_key: "receipt", language, body });
const shop = { shop_name: "Shop", shop_phone: "077", timezone: "Asia/Colombo" };

describe("R6-backend: WhatsApp variables for goods", () => {
  const goods = (over = {}) => ({ description: "Tolsen Nail 2\"", qty: 2, unit_label: "box", unit_factor: 10, base_qty: 20, returned_base_qty: 0, status: "sold", ...over });

  it("the new placeholders exist, with samples in en and si (real Sinhala)", () => {
    for (const k of ["items_sold", "sale_total", "rent_total"]) {
      expect(PLACEHOLDERS).toContain(k);
      for (const lang of LANGUAGES) expect(SAMPLE_VARS[lang][k], `${lang}.${k}`).toBeTruthy();
    }
    expect(SAMPLE_VARS.si.items_sold).toMatch(/[඀-෿]/);
    expect(SAMPLE_VARS.en.items_sold).not.toMatch(/[඀-෿]/);
    for (const lang of LANGUAGES) for (const k of PLACEHOLDERS) expect(SAMPLE_VARS[lang]).toHaveProperty(k);
  });

  it("items_sold: net of returns; voided and fully returned lines are left out", () => {
    const lines = [
      goods(),
      goods({ description: "Hammer", qty: 3, unit_label: "pcs", unit_factor: 1, base_qty: 3, returned_base_qty: 1, status: "partly_returned" }),
      goods({ description: "Drill", qty: 1, unit_label: "pcs", base_qty: 1, returned_base_qty: 1, status: "returned" }),
      goods({ description: "Tape", qty: 1, unit_label: "pcs", base_qty: 1, status: "voided" }),
    ];
    expect(buildItemsSoldList(lines)).toBe('• 2 box × Tolsen Nail 2"\n• 2 pcs × Hammer');
    // half a box returned: 1 box left
    expect(buildItemsSoldList([goods({ returned_base_qty: 10, status: "partly_returned" })])).toBe('• 1 box × Tolsen Nail 2"');
    expect(buildItemsSoldList([])).toBe("");
    // 3 of 50 kg returned from 2 boxes of 25: what's left isn't whole boxes, so it reads in kg
    expect(
      buildItemsSoldList([goods({ unit_factor: 25, base_qty: 50, returned_base_qty: 3, status: "partly_returned", Product: { base_unit: "kg" } })]),
    ).toBe('• 47 kg × Tolsen Nail 2"');
  });

  it("items_sold uses the same cap and '+N more' rule as the rental list (en and si)", () => {
    const many = Array.from({ length: 9 }, (_, i) => goods({ description: `Item ${i + 1}`, qty: 1, unit_label: "pcs", base_qty: 1 }));
    const en = buildItemsSoldList(many).split("\n");
    expect(en).toHaveLength(7);
    expect(en[6]).toBe("… +3 more");
    expect(buildItemsSoldList(many, { language: "si" }).split("\n")[6]).toBe("… තවත් 3ක්");
    const rentals = Array.from({ length: 9 }, (_, i) => ({ borrow_quantity: 1, Equipment: { equipment_name: `M${i}` } }));
    expect(buildItemsList(rentals).split("\n")).toHaveLength(7);
  });

  it("{{items}} lists rentals then goods; {{item_count}} counts both; rentals-only is unchanged", () => {
    const lines = [{ borrow_quantity: 2, Equipment: { equipment_name: "Breaker", serial_number: "EQ-1" } }];
    const invoice = { invoice_id: 7, total_amount: 3000, sale_total: 1000, rental_total: 2000, bill_kind: "mixed" };
    const v = buildVars({ shop, customer: null, invoice, lines, saleLines: [goods()], paid: 0, language: "en" });
    expect(v.items).toBe('• 2 × Breaker (EQ-1)\n• 2 box × Tolsen Nail 2"');
    expect(v.items_sold).toBe('• 2 box × Tolsen Nail 2"');
    expect(v.item_count).toBe("4");
    expect(v.sale_total).toBe("Rs. 1,000");
    expect(v.rent_total).toBe("Rs. 2,000");

    const rental = buildVars({ shop, customer: null, invoice: { invoice_id: 8, total_amount: 2000, sub_total: 2000, rental_total: 2000, bill_kind: "rental" }, lines, saleLines: [], paid: 0, language: "en" });
    expect(rental.items).toBe("• 2 × Breaker (EQ-1)");
    expect(rental.items_sold).toBe("");
    expect(rental.sale_total).toBe("");
    expect(rental.item_count).toBe("2");
    expect(rental.rent_total).toBe("Rs. 2,000");
    // a return reminder is about machines still out: no goods in it
    const reminder = buildVars({ shop, customer: null, invoice, lines, saleLines: [goods()], paid: 0, language: "en", dueDate: "2026-11-21", today: "2026-11-22" });
    expect(reminder.items).toBe("• 2 × Breaker (EQ-1)");
    expect(reminder.item_count).toBe("2");
  });

  it("composeMessage on a sale bill: goods total after returns; the return takes a line out", async () => {
    const h = makeShop();
    setTemplate(h, ALL_VARS_TEMPLATE);
    const bill = await saleBill(h);
    let m = await composeMessage(h.models, { template_key: "receipt", invoice_id: bill.invoice_id });
    expect(m.body).toContain('• 3 pcs × Hammer\n• 2 box × Tolsen Nail 2"');
    expect(m.body).toContain(`SALE ${formatMoney(bill.sale_total)}`);
    expect(m.body).not.toContain("RENT"); // sale-only: no rental total, the line vanishes
    expect(m.body).toContain("COUNT 5");
    // return the hammers: the line leaves the list and the goods total drops
    await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 3 }]);
    m = await composeMessage(h.models, { template_key: "receipt", invoice_id: bill.invoice_id });
    expect(m.body).not.toContain("Hammer");
    expect(m.body).toContain('• 2 box × Tolsen Nail 2"');
    expect(m.body).toContain(`SALE ${formatMoney(360)}`);
    expect(bill.sale_total).toBe(360);
  });

  it("composeMessage on a mixed bill fills items, items_sold, sale_total and rent_total", async () => {
    const h = makeShop();
    withEquipmentNames(h);
    setTemplate(h, ALL_VARS_TEMPLATE);
    const bill = await mixedBill(h);
    withEquipmentNames(h);
    const m = await composeMessage(h.models, { template_key: "receipt", invoice_id: bill.invoice_id });
    expect(m.body).toContain('ITEMS:\n• 1 × Breaker\n• 2 pcs × Hammer\n• 1 box × Tolsen Nail 2"\nSOLD:\n• 2 pcs × Hammer\n• 1 box × Tolsen Nail 2"');
    expect(m.body).toContain("COUNT 4");
    expect(m.body).toContain(`SALE ${formatMoney(bill.sale_total)}`);
    expect(m.body).toContain(`RENT ${formatMoney(bill.rental_total)}`);
    expect(bill.sale_total).toBe(980);
    expect(bill.rental_total).toBe(1000);
    // the shop's default text (which only knows {{items}}) reads right on this bill
    h.templates.length = 0;
    const dflt = await composeMessage(h.models, { template_key: "receipt", invoice_id: bill.invoice_id });
    expect(dflt.body).toContain("• 1 × Breaker\n• 2 pcs × Hammer");
  });

  it("a rental-only bill reads exactly as before", async () => {
    const h = makeShop();
    const bill = await rentalBill(h);
    withEquipmentNames(h);
    const m = await composeMessage(h.models, { template_key: "receipt", invoice_id: bill.invoice_id });
    expect(m.body).toContain("• 1 × Breaker");
    expect(m.body).not.toContain("pcs");
    setTemplate(h, ALL_VARS_TEMPLATE);
    const all = await composeMessage(h.models, { template_key: "receipt", invoice_id: bill.invoice_id });
    expect(all.body).toBe("ITEMS:\n• 1 × Breaker\nSOLD:\nCOUNT 1\nRENT Rs. 1,000\nTOTAL Rs. 1,000");
  });

  it("default templates are untouched and the walk-in customer is still refused", async () => {
    for (const lang of LANGUAGES) expect(DEFAULT_TEMPLATES.receipt[lang]).not.toMatch(/items_sold|sale_total|rent_total/);
    const h = makeShop();
    const bill = await saleBill(h, { customer_id: undefined, walk_in: true, payment: { amount: 1560 } });
    await expect(composeMessage(h.models, { template_key: "receipt", invoice_id: bill.invoice_id })).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe("R6-backend: print data (snapshots, doc types, ORIGINAL / REPRINT)", () => {
  const print = (h, bill, data = {}) => recordPrintLog(h.models, { userId: 1, username: "nimal", first_name: "Nimal", last_name: "Perera" }, { invoice_id: bill.invoice_id, doc_type: "SALE_RECEIPT", ...data });

  it("the print log model accepts the two new doc types and still refuses nonsense", async () => {
    expect(PRINT_DOC_TYPES).toEqual(["DISPATCH", "COMPLETED", "DRAFT", "RETURN_SETTLEMENT", "SALE_RECEIPT", "RETURN_SLIP"]);
    const base = { doc_number: "INV-1", printed_by_user_id: 1 };
    for (const t of PRINT_DOC_TYPES) await expect(assertSavable("InvoicePrintLog", { ...base, doc_type: t })).resolves.toBeUndefined();
    await expect(assertSavable("InvoicePrintLog", { ...base, doc_type: "BOGUS" })).rejects.toThrow();
    await expect(assertSavable("InvoicePrintLog", { ...base })).resolves.toBeUndefined(); // the default still works
  });

  it("a sale receipt snapshot carries the goods, the totals and the cashier, and no cost figures", async () => {
    const h = makeShop();
    const bill = await saleBill(h, { discount: 0 });
    const log = await print(h, bill, { bill_snapshot: { change_due: 40, extra_marker: "kept" } });
    expect(log.doc_type).toBe("SALE_RECEIPT");
    const snap = log.bill_snapshot;
    expect(snap).toMatchObject({ bill_kind: "sale", sale_total: 1560, rental_total: 0, returned_total: 0, change_due: 40, extra_marker: "kept", issued_by: { name: "Nimal Perera", username: "nimal" } });
    expect(snap.SaleLines).toHaveLength(2);
    expect(snap.SaleLines[1]).toMatchObject({
      description: 'Tolsen Nail 2"', qty: 2, unit_label: "box", unit_price: 180, line_discount: 0, bill_discount_share: 0,
      line_total: 360, base_qty: 20, returned_base_qty: 0, status: "sold", line_kind: "item",
    });
    for (const l of snap.SaleLines) {
      expect(l).not.toHaveProperty("unit_cost");
      expect(l).not.toHaveProperty("cost_total");
    }
    expect(log.total_items).toBe(2);
    await assertSavable("InvoicePrintLog", { doc_number: log.doc_number, printed_by_user_id: 1, doc_type: log.doc_type });
  });

  it("a reprint shows the goods exactly as first printed, even after a return", async () => {
    const h = makeShop();
    const bill = await saleBill(h);
    const first = await print(h, bill);
    const frozen = JSON.stringify(first.bill_snapshot.SaleLines);
    await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }]);
    expect(JSON.stringify(first.bill_snapshot.SaleLines)).toBe(frozen); // the saved log does not move
    expect(first.bill_snapshot.returned_total).toBe(0);
    const later = await print(h, bill);
    expect(later.bill_snapshot.returned_total).toBe(400);
    expect(later.bill_snapshot.SaleLines[0]).toMatchObject({ returned_base_qty: 1, status: "partly_returned" });
  });

  it("a mixed bill keeps both parts; a rental-only bill gets an empty goods list", async () => {
    const h = makeShop();
    const mixed = await print(h, await mixedBill(h), { doc_type: "DISPATCH" });
    expect(mixed.bill_snapshot).toMatchObject({ bill_kind: "mixed", sale_total: 980, rental_total: 1000 });
    expect(mixed.bill_snapshot.SaleLines).toHaveLength(2);
    const rental = await print(h, await rentalBill(h), { doc_type: "DISPATCH" });
    expect(rental.bill_snapshot).toMatchObject({ bill_kind: "rental", sale_total: 0, SaleLines: [] });
    expect(rental.bill_snapshot).not.toHaveProperty("change_due");
  });

  it("ORIGINAL then REPRINT, counted per bill and per doc type", async () => {
    const h = makeShop();
    const a = await saleBill(h);
    const b = await saleBill(h);
    expect((await print(h, a)).print_kind).toBe("ORIGINAL");
    const again = await print(h, a);
    expect(again.print_kind).toBe("REPRINT");
    expect(again.print_number).toBe(2);
    expect((await print(h, a)).print_number).toBe(3);
    expect((await print(h, b)).print_kind).toBe("ORIGINAL"); // another bill
    expect((await print(h, a, { doc_type: "DISPATCH" })).print_kind).toBe("ORIGINAL"); // another document
    expect((await print(h, a, { doc_type: "DISPATCH" })).print_kind).toBe("REPRINT");
  });

  it("RETURN_SLIP: needs a real return of that bill, carries it, and ORIGINAL/REPRINT is per return", async () => {
    const h = makeShop();
    const bill = await saleBill(h);
    await expect(print(h, bill, { doc_type: "RETURN_SLIP" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(print(h, bill, { doc_type: "RETURN_SLIP", return_id: 999 })).rejects.toMatchObject({ statusCode: 404 });
    await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }]);
    await ret(h, bill.invoice_id, [{ sale_line_id: 2, qty: 1 }]);
    const [second, first] = await listSaleReturns(h.models, bill.invoice_id);
    const slip1 = await print(h, bill, { doc_type: "RETURN_SLIP", return_id: first.return_id });
    expect(slip1.print_kind).toBe("ORIGINAL");
    expect(slip1.bill_snapshot.return_id).toBe(first.return_id);
    expect(slip1.bill_snapshot.return.lines[0]).toMatchObject({ description: "Hammer", qty: 1, unit_label: "pcs" });
    expect((await print(h, bill, { doc_type: "RETURN_SLIP", return_id: first.return_id })).print_kind).toBe("REPRINT");
    expect((await print(h, bill, { doc_type: "RETURN_SLIP", return_id: second.return_id })).print_kind).toBe("ORIGINAL");
    // the return id may also arrive inside the snapshot
    expect((await print(h, bill, { doc_type: "RETURN_SLIP", bill_snapshot: { return_id: second.return_id } })).print_kind).toBe("REPRINT");
    expect(snapshotSaleLines(null)).toEqual([]);
  });
});

describe("R6-backend: the print doc type migration", () => {
  const fakeQi = (columnType, { nullable = "NO", dflt = "DISPATCH" } = {}) => {
    const state = { columnType, altered: [] };
    const sequelize = {
      escape: (v) => `'${String(v).replace(/'/g, "''")}'`,
      query: vi.fn(async (sql) => {
        if (/information_schema/i.test(sql)) return [{ columnType: state.columnType, nullable, dflt }];
        state.altered.push(sql);
        const m = /ENUM\((.*?)\)\s+(NOT NULL|NULL)/.exec(sql);
        if (m) state.columnType = `enum(${m[1]})`;
        return [];
      }),
    };
    return { qi: { sequelize, showAllTables: async () => ["INVOICE_PRINT_LOGS"] }, state };
  };
  const OLD = "enum('DISPATCH','COMPLETED','DRAFT','RETURN_SETTLEMENT')";

  it("adds the missing values once, keeps the old ones and the default, and a second run changes nothing", async () => {
    const { qi, state } = fakeQi(OLD);
    await printDocTypesMigration.up({ context: qi });
    expect(state.altered).toHaveLength(1);
    expect(state.altered[0]).toContain("ENUM('DISPATCH','COMPLETED','DRAFT','RETURN_SETTLEMENT','SALE_RECEIPT','RETURN_SLIP') NOT NULL DEFAULT 'DISPATCH'");
    await printDocTypesMigration.up({ context: qi });
    expect(state.altered).toHaveLength(1); // idempotent: no second ALTER
    expect(parseEnumValues(state.columnType)).toEqual(PRINT_DOC_TYPES);
  });

  it("reads a MariaDB-style quoted default ('DISPATCH') and keeps it", async () => {
    const { qi, state } = fakeQi(OLD, { dflt: "'DISPATCH'" });
    await printDocTypesMigration.up({ context: qi });
    expect(state.altered[0]).toContain("NOT NULL DEFAULT 'DISPATCH'");
  });

  it("adds only the value that is missing, and leaves a non-enum column alone", async () => {
    const half = fakeQi("enum('DISPATCH','COMPLETED','DRAFT','RETURN_SETTLEMENT','SALE_RECEIPT')");
    expect(await ensureEnumValues(half.qi, "INVOICE_PRINT_LOGS", "doc_type", ["SALE_RECEIPT", "RETURN_SLIP"])).toEqual(["RETURN_SLIP"]);
    const text = fakeQi("varchar(30)");
    expect(await ensureEnumValues(text.qi, "INVOICE_PRINT_LOGS", "doc_type", ["RETURN_SLIP"])).toEqual([]);
    expect(text.state.altered).toHaveLength(0);
    expect(parseEnumValues("enum('it''s','b')")).toEqual(["it's", "b"]);
  });
});

describe("R6-backend: GET /invoices/:id/sale-returns", () => {
  it("is routed with the permission that reads a bill", () => {
    const layer = invoiceRoutes.stack.find((l) => l.route?.path === "/:id/sale-returns" && l.route.methods.get);
    expect(layer).toBeTruthy();
    expect(layer.route.stack).toHaveLength(2); // permission check + handler
  });

  it("lists a bill's returns newest first, in the shape the slip needs", async () => {
    const h = makeShop();
    const bill = await saleBill(h);
    await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1, condition: "damaged" }], { reason: "Bent" });
    await ret(h, bill.invoice_id, [{ sale_line_id: 2, qty: 1 }]);
    const out = await listSaleReturns(h.models, bill.invoice_id);
    expect(out).toHaveLength(2);
    expect(out[0].return_id).toBeGreaterThan(out[1].return_id);
    expect(out[1]).toMatchObject({
      cashier: "Nimal Perera",
      lines: [{ sale_line_id: 1, description: "Hammer", qty: 1, unit_label: "pcs", condition: "damaged", value: 400 }],
      value: 400,
      settlement: { mode: "refund", refunded: 400, credited: 0, method: expect.any(String) },
      reason: "Bent",
    });
    expect(out[0].lines[0]).toMatchObject({ description: 'Tolsen Nail 2"', qty: 1, unit_label: "box", condition: "good", value: 180 });
    expect(typeof out[0].balance_after).toBe("number");
    expect(out[0].returned_at).toBeTruthy();
    expect(Object.keys(out[0]).sort()).toEqual(["balance_after", "cashier", "lines", "reason", "return_id", "returned_at", "settlement", "value"].sort());
  });

  it("reads a state_payload that came back as a string, and an older trace missing fields", async () => {
    const h = makeShop();
    const bill = await saleBill(h);
    await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }]);
    const trace = h.traceRecords.find((t) => t.event_action === "SALE_RETURN");
    trace.state_payload = JSON.stringify(trace.state_payload); // as MariaDB can return it
    // an older return: no description, no unit, no balance, no reason, line value only
    await h.models.InvoiceTrace.create({
      invoice_id: bill.invoice_id,
      actor_user_id: 1,
      event_category: "RETAIL",
      event_action: "SALE_RETURN",
      state_payload: { lines: [{ sale_line_id: 2, qty: 1, base_qty: 10, value: 180 }], value: 180, settlement: { mode: "refund", refunded: 180, credited: 0 } },
    });
    const out = await listSaleReturns(h.models, bill.invoice_id);
    expect(out).toHaveLength(2);
    expect(out[0].lines[0]).toMatchObject({ description: 'Tolsen Nail 2"', unit_label: "box", condition: "good", value: 180 });
    expect(out[0]).toMatchObject({ balance_after: null, reason: null, settlement: { method: null } });
    expect(out[1].lines[0]).toMatchObject({ description: "Hammer", qty: 1, value: 400 });
    expect(out[1].value).toBe(400);
  });

  it("a return counted in the item's smallest unit shows that unit, not 'base' (new and older traces)", async () => {
    const h = makeShop();
    const bill = await saleBill(h);
    await ret(h, bill.invoice_id, [{ sale_line_id: 2, qty: 3, unit_id: null }]);
    expect(h.traceRecords.find((t) => t.event_action === "SALE_RETURN").state_payload.lines[0].unit_label).toBe("pcs");
    await h.models.InvoiceTrace.create({
      invoice_id: bill.invoice_id, actor_user_id: 1, event_category: "RETAIL", event_action: "SALE_RETURN",
      state_payload: { lines: [{ sale_line_id: 2, description: 'Tolsen Nail 2"', qty: 3, unit: "base", base_qty: 3, value: 54 }], value: 54, settlement: { mode: "refund", refunded: 54, credited: 0 } },
    });
    const out = await listSaleReturns(h.models, bill.invoice_id);
    expect(out.map((r) => r.lines[0].unit_label)).toEqual(["pcs", "pcs"]);
  });

  it("new returns write what the slip needs into the trace; a bill with no returns gives []; unknown bill is 404", async () => {
    const h = makeShop();
    const bill = await saleBill(h);
    expect(await listSaleReturns(h.models, bill.invoice_id)).toEqual([]);
    await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }]);
    const p = h.traceRecords.find((t) => t.event_action === "SALE_RETURN").state_payload;
    expect(p.lines[0]).toMatchObject({ description: "Hammer", unit_label: "pcs" });
    expect(p.balance_after).toBe(await (async () => (await listSaleReturns(h.models, bill.invoice_id))[0].balance_after)());
    await expect(listSaleReturns(h.models, 99999)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("R6-backend: receipt settings", () => {
  const DEFAULTS = { shortSaleReceipt: true, saleFooter: "", showItemsSoldOnRentalReceipt: true, showCashier: true, returnSlipFooter: "" };

  it("defaults are returned when nothing is saved, and for older saved settings without a receipt block", async () => {
    const h = makeSalesHarness();
    expect((await getRetailSettings(h.models)).receipt).toEqual(DEFAULTS);
    expect(mergeRetailSettings({ negativeStock: "block" }).receipt).toEqual(DEFAULTS);
    expect(mergeRetailSettings({ receipt: "junk" }).receipt).toEqual(DEFAULTS);
    expect(mergeRetailSettings({ receipt: { showCashier: "yes", saleFooter: 5, returnSlipFooter: "x".repeat(400) } }).receipt).toEqual({ ...DEFAULTS, returnSlipFooter: "x".repeat(300) });
  });

  it("saves a partial patch without losing the rest, through GET/PUT", async () => {
    const h = makeSalesHarness();
    const a = await updateRetailSettings(h.models, { receipt: { saleFooter: "Thank you. Goods can be returned within 7 days.", showCashier: false } });
    expect(a.receipt).toEqual({ ...DEFAULTS, saleFooter: "Thank you. Goods can be returned within 7 days.", showCashier: false });
    const b = await updateRetailSettings(h.models, { receipt: { returnSlipFooter: "Keep this slip.", shortSaleReceipt: false } });
    expect(b.receipt).toEqual({ shortSaleReceipt: false, saleFooter: "Thank you. Goods can be returned within 7 days.", showItemsSoldOnRentalReceipt: true, showCashier: false, returnSlipFooter: "Keep this slip." });
    expect((await getRetailSettings(h.models)).receipt).toEqual(b.receipt);
    expect(b.negativeStock).toBe("warn"); // other settings untouched
    expect((await updateRetailSettings(h.models, { receipt: { saleFooter: "x".repeat(300) } })).receipt.saleFooter).toHaveLength(300);
  });

  it("refuses bad values with 400", async () => {
    const h = makeSalesHarness();
    for (const receipt of [
      { saleFooter: "x".repeat(301) },
      { returnSlipFooter: "x".repeat(301) },
      { shortSaleReceipt: "true" },
      { showItemsSoldOnRentalReceipt: 1 },
      { showCashier: null },
      { saleFooter: 12 },
      { logo: "a.png" },
      "text",
      [],
      null,
    ]) {
      await expect(updateRetailSettings(h.models, { receipt }), JSON.stringify(receipt)).rejects.toMatchObject({ statusCode: 400 });
    }
  });
});
