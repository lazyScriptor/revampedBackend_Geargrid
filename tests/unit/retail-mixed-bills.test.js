import { describe, expect, it, vi } from "vitest";
import { makeSalesHarness } from "../helpers/retailHarness.js";
import {
  completeInvoice,
  createDispatchInvoice,
  getAllInvoices,
  processReturn,
  updateInvoiceFees,
} from "../../src/services/invoiceService.js";
import { deleteInvoice, listDeletedInvoices, restoreInvoice } from "../../src/services/invoiceDeletionService.js";
import { checkStockIntegrity, splitByWeight } from "../../src/modules/retail/index.js";

vi.mock("../../src/services/notificationService.js", () => ({ createNotification: vi.fn() }));
vi.mock("../../src/services/accrualService.js", () => ({ refreshAccruals: vi.fn(async () => ({})) }));

const admin = { userId: 1, permissions: new Set(["*"]) };

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

const makeShop = (opts = {}) =>
  makeSalesHarness({
    rollback: true,
    equipment: [{ equipment_id: 1, equipment_name: "Breaker", available_qty: 3, total_owned_qty: 3 }],
    products: [
      { product_id: 1, code: "H1", name: "Hammer", sell_price: 400, avg_cost: 250 },
      { product_id: 2, code: "N1", name: "Nails 1kg", sell_price: 200, avg_cost: 120 },
      { product_id: 3, code: "D1", name: "Drill", sell_price: 9000, avg_cost: 6000, tracking: "serial", serial_capture: "receive" },
    ],
    levels: [
      { product_id: 1, warehouse_id: 1, qty_on_hand: 10 },
      { product_id: 2, warehouse_id: 1, qty_on_hand: 10 },
      { product_id: 3, warehouse_id: 1, qty_on_hand: 1 },
    ],
    serials: [{ product_id: 3, serial_no: "DR-1", warehouse_id: 1 }],
    customers: [
      { customer_id: 5, first_name: "Ali" },
      { customer_id: 9, first_name: "Walk-in", is_walk_in: true },
    ],
    ...opts,
  });

const cents = (n) => Math.round(Number(n) * 100);
const stockOf = (h, pid) => Number(h.levelRecords.find((l) => l.product_id === pid).qty_on_hand);

const mixedPayload = (over = {}) => ({
  customer_id: 5,
  items: [machine()],
  sale_items: [
    { product_id: 1, qty: 2 },
    { product_id: 2, qty: 1 },
  ],
  fees: { transport: 50, discount: 100.01, advance: 500 },
  effectivePermissions: ["retail:add_unlisted"],
  ...over,
});

describe("R4-backend: mixed bills", () => {
  it("1. totals to the cent, the discount split across the machines and each sold line", async () => {
    const h = makeShop();
    const bill = await createDispatchInvoice(h.models, mixedPayload(), 1);

    expect(bill.bill_kind).toBe("mixed");
    expect(bill.status).toBe("Active");
    expect(bill.id_card_status).toBe(1);
    expect(bill.sub_total).toBe(2000); // 1000 rental + 800 + 200 goods, before the bill discount
    expect(bill.discount_amount).toBe(100.01);
    expect(bill.transport_fee).toBe(50);
    // splitByWeight(10001, [1000, 800, 200] x 100): 5000 / 4000 / 1000, remainder 1 to the biggest weight
    expect(h.saleLineRecords.map((l) => Number(l.bill_discount_share))).toEqual([40, 10]);
    expect(bill.rental_total).toBe(949.99);
    expect(bill.sale_total).toBe(950);
    expect(bill.total_amount).toBe(1949.99);
    expect(cents(bill.total_amount)).toBe(cents(1000 + 1000 + 50 - 100.01));
    expect(cents(bill.rental_total) + cents(bill.sale_total) + cents(bill.transport_fee)).toBe(cents(bill.total_amount));
    expect(bill.number_of_days_of_the_bill).toBe(1);

    // machines out, goods off the shelf
    expect(h.equipmentRecords[0]).toMatchObject({ available_qty: 2, rented_qty: 1 });
    expect(stockOf(h, 1)).toBe(8);
    expect(stockOf(h, 2)).toBe(9);
    expect(h.invoiceLineRecords).toHaveLength(1);
    expect(h.saleLineRecords).toHaveLength(2);
  });

  it("1b. one payment, recorded once as the machines' advance; settle_now is ignored", async () => {
    const h = makeShop();
    const bill = await createDispatchInvoice(h.models, mixedPayload({ settle_now: true, fees: { transport: 0, discount: 0, advance: 2400 } }), 1);
    expect(h.paymentRecords).toHaveLength(1);
    expect(h.paymentRecords[0]).toMatchObject({ payment_amount: 2400, is_advance: true, method: "Cash" });
    expect(bill.advance_paid).toBe(2400);
    expect(bill.status).toBe("Active");
    expect(bill.total_amount).toBe(2000);
  });

  it("1c. one INVOICE_CREATED trace that mentions both", async () => {
    const h = makeShop();
    await createDispatchInvoice(h.models, mixedPayload({ items: [machine(), machine({ equipment_id: 1 })] }), 1);
    const traces = h.models.InvoiceTrace.create.mock.calls.map((c) => c[0]).filter((t) => t.event_action === "INVOICE_CREATED");
    expect(traces).toHaveLength(1);
    expect(traces[0].comments).toContain("2 machines rented, 2 items sold");
  });

  it("2. walk-in cannot rent: 422, nothing saved", async () => {
    const h = makeShop();
    await expect(createDispatchInvoice(h.models, mixedPayload({ walk_in: true, customer_id: undefined }), 1)).rejects.toMatchObject({
      statusCode: 422,
      message: "Choose a customer to rent equipment",
    });
    await expect(createDispatchInvoice(h.models, mixedPayload({ customer_id: 9 }), 1)).rejects.toMatchObject({ statusCode: 422 });
    expect(h.invoiceRecords).toHaveLength(0);
    expect(h.equipmentRecords[0].available_qty).toBe(3);
  });

  it("3. price_changed on a mixed bill rolls the machines back too", async () => {
    const h = makeShop();
    await expect(
      createDispatchInvoice(
        h.models,
        mixedPayload({ sale_items: [{ product_id: 1, qty: 1, expected_unit_price: 350 }] }),
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "price_changed" });
    expect(h.equipmentRecords[0]).toMatchObject({ available_qty: 3, rented_qty: 0 });
    expect(h.invoiceRecords).toHaveLength(0);
    expect(h.invoiceLineRecords).toHaveLength(0);
    expect(h.paymentRecords).toHaveLength(0);
  });

  it("3b. out_of_stock on a mixed bill rolls the machines back too (negativeStock = block)", async () => {
    const h = makeShop({ retailSettings: { negativeStock: "block" } });
    await expect(
      createDispatchInvoice(h.models, mixedPayload({ sale_items: [{ product_id: 1, qty: 11 }] }), 1),
    ).rejects.toMatchObject({ statusCode: 409, code: "out_of_stock" });
    expect(h.equipmentRecords[0]).toMatchObject({ available_qty: 3, rented_qty: 0 });
    expect(stockOf(h, 1)).toBe(10);
    expect(h.invoiceRecords).toHaveLength(0);
    expect(h.saleLineRecords).toHaveLength(0);
    expect(h.movementRecords).toHaveLength(0);
  });

  it("3c. a discount over the limit across the whole bill needs approval", async () => {
    const h = makeShop();
    await expect(
      createDispatchInvoice(h.models, mixedPayload({ fees: { transport: 0, discount: 300, advance: 0 } }), 1),
    ).rejects.toMatchObject({ statusCode: 403, code: "discount_over_limit" });
    expect(h.equipmentRecords[0].available_qty).toBe(3);
  });

  it("4. status follows the machines: back -> PendingPayment with goods on it; complete needs only the balance", async () => {
    const h = makeShop();
    const bill = await createDispatchInvoice(h.models, mixedPayload({ fees: { transport: 0, discount: 0, advance: 500 } }), 1);
    expect(bill.status).toBe("Active");

    await expect(completeInvoice(h.models, bill.invoice_id, {}, 1)).rejects.toMatchObject({ statusCode: 409 });

    const lineId = h.invoiceLineRecords[0].line_id;
    await processReturn(
      h.models,
      {
        invoice_id: bill.invoice_id,
        lines_returned: [{ line_id: lineId, good_qty: 1, defective_qty: 0, actual_return_date: "2026-11-21" }],
        final_payment_amount: 0,
      },
      1,
    );
    expect(bill.status).toBe("PendingPayment");
    expect(h.equipmentRecords[0]).toMatchObject({ available_qty: 3, rented_qty: 0 });
    expect(stockOf(h, 1)).toBe(8); // goods stay sold

    // 2000 owed, 500 paid: the balance is what blocks completing, not the goods
    await expect(completeInvoice(h.models, bill.invoice_id, {}, 1)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("still owes"),
    });
    await h.models.Payment.create({ invoice_id: bill.invoice_id, payment_amount: 1500, method: "Cash" });
    await completeInvoice(h.models, bill.invoice_id, {}, 1);
    expect(bill.status).toBe("Completed");
  });
});

describe("R4-backend: rental_total stays right", () => {
  it("5. a new rental bill sets rental_total = subtotal - discount, and stays a rental bill", async () => {
    const h = makeShop();
    const bill = await createDispatchInvoice(
      h.models,
      { customer_id: 5, items: [machine({ borrow_quantity: 2 })], fees: { transport: 100, discount: 150, advance: 0 } },
      1,
    );
    expect(bill.bill_kind).toBe("rental");
    expect(bill.sub_total).toBe(2000);
    expect(bill.rental_total).toBe(1850);
    expect(bill.total_amount).toBe(1950);
    expect(h.saleLineRecords).toHaveLength(0);
  });

  it("5b. returns add the rental days they bill to rental_total, with sub_total", async () => {
    const h = makeShop();
    const bill = await createDispatchInvoice(
      h.models,
      {
        customer_id: 5,
        items: [machine({ borrow_date: "2026-11-20", expected_return_date: "2026-11-20", track_overdue: false })],
        fees: { transport: 0, discount: 100, advance: 0 },
      },
      1,
    );
    expect(bill.rental_total).toBe(900);
    await processReturn(
      h.models,
      {
        invoice_id: bill.invoice_id,
        lines_returned: [
          { line_id: h.invoiceLineRecords[0].line_id, good_qty: 1, defective_qty: 0, actual_return_date: "2026-11-23", actual_return_at: new Date("2026-11-23T05:00:00Z") },
        ],
        final_payment_amount: 0,
      },
      1,
    );
    const added = bill.sub_total - 1000;
    expect(added).toBeGreaterThan(0);
    expect(bill.rental_total).toBe(900 + added);
  });

  it("5c. a discount edit moves rental_total only; sale_total and the line shares never change", async () => {
    const h = makeShop();
    const bill = await createDispatchInvoice(h.models, mixedPayload({ fees: { transport: 50, discount: 100.01, advance: 0 } }), 1);
    const shares = h.saleLineRecords.map((l) => l.bill_discount_share);

    await updateInvoiceFees(h.models, bill.invoice_id, { discount_amount: 150 }, 1);
    expect(bill.discount_amount).toBe(150);
    expect(bill.rental_total).toBe(900);
    expect(bill.sale_total).toBe(950);
    expect(bill.total_amount).toBe(1900);
    expect(h.saleLineRecords.map((l) => l.bill_discount_share)).toEqual(shares);

    await updateInvoiceFees(h.models, bill.invoice_id, { transport_fee: 80 }, 1);
    expect(bill.rental_total).toBe(900);
    expect(bill.sale_total).toBe(950);
    expect(bill.total_amount).toBe(1930);
  });

  it("5d. a discount bigger than what is left of the rental part is refused (409) on a mixed bill", async () => {
    const h = makeShop();
    const bill = await createDispatchInvoice(h.models, mixedPayload({ fees: { transport: 0, discount: 0, advance: 0 } }), 1);
    await expect(updateInvoiceFees(h.models, bill.invoice_id, { discount_amount: 1200 }, 1)).rejects.toMatchObject({ statusCode: 409 });
    expect(bill.discount_amount).toBe(0);
    expect(bill.total_amount).toBe(2000);
  });

  it("5e. a rental-only bill's discount edit moves rental_total too", async () => {
    const h = makeShop();
    const bill = await createDispatchInvoice(h.models, { customer_id: 5, items: [machine()], fees: { transport: 0, discount: 0, advance: 0 } }, 1);
    await updateInvoiceFees(h.models, bill.invoice_id, { discount_amount: 200 }, 1);
    expect(bill.rental_total).toBe(800);
    expect(bill.total_amount).toBe(800);
  });
});

describe("R4-backend: deleting and restoring bills with goods", () => {
  const unlistedBill = async (h) =>
    createDispatchInvoice(
      h.models,
      mixedPayload({
        sale_items: [
          { product_id: 1, qty: 2 },
          { product_id: 3, qty: 1, serial_number: "DR-1" },
          { line_kind: "unlisted", description: "Mystery clamp", qty: 1, unit_price: 300 },
        ],
        fees: { transport: 0, discount: 0, advance: 0 },
      }),
      1,
    );

  it("6. delete: machines and goods go back, SALE_VOID at unit cost, serial in stock, unsorted exception declined", async () => {
    const h = makeShop();
    const bill = await unlistedBill(h);
    expect(stockOf(h, 1)).toBe(8);
    expect(h.serialRecords[0].status).toBe("sold");
    expect(h.exceptionRecords.some((e) => e.type === "unlisted_item" && e.status === "recorded")).toBe(true);

    const res = await deleteInvoice(h.models, bill.invoice_id, admin, { reason: "Created by mistake" });
    expect(res).toMatchObject({ unitsRestored: 1, goodsVoided: 3 });

    expect(bill.is_deleted).toBe(true);
    expect(h.equipmentRecords[0]).toMatchObject({ available_qty: 3, rented_qty: 0 });
    expect(stockOf(h, 1)).toBe(10);
    expect(stockOf(h, 3)).toBe(1);
    expect(h.serialRecords[0]).toMatchObject({ status: "in_stock", sale_line_id: null });
    expect(h.saleLineRecords.every((l) => l.status === "voided")).toBe(true);

    const voids = h.movementRecords.filter((m) => m.type === "SALE_VOID");
    expect(voids).toHaveLength(2); // hammer line, drill line; the unsorted unlisted line took no stock
    expect(voids.find((m) => m.product_id === 1)).toMatchObject({ qty_change: 2, unit_cost: 250 });
    expect(voids.find((m) => m.product_id === 3)).toMatchObject({ qty_change: 1, unit_cost: 6000 });
    expect(h.exceptionRecords.find((e) => e.type === "unlisted_item")).toMatchObject({ status: "declined", note: "bill deleted" });
  });

  it("7. restore: stock taken again, exception back, serial sold again", async () => {
    const h = makeShop();
    const bill = await unlistedBill(h);
    await deleteInvoice(h.models, bill.invoice_id, admin, { reason: "Created by mistake" });
    await restoreInvoice(h.models, bill.invoice_id, admin);

    expect(bill.is_deleted).toBe(false);
    expect(h.equipmentRecords[0]).toMatchObject({ available_qty: 2, rented_qty: 1 });
    expect(stockOf(h, 1)).toBe(8);
    expect(stockOf(h, 3)).toBe(0);
    expect(h.serialRecords[0]).toMatchObject({ status: "sold" });
    expect(h.saleLineRecords.every((l) => l.status === "sold")).toBe(true);
    expect(h.exceptionRecords.find((e) => e.type === "unlisted_item")).toMatchObject({ status: "recorded", note: null });
  });

  it("7b. restore under 'block' is refused when the stock is gone, and nothing changes", async () => {
    const h = makeShop({ retailSettings: { negativeStock: "block" } });
    const bill = await unlistedBill(h);
    await deleteInvoice(h.models, bill.invoice_id, admin, { reason: "Created by mistake" });
    h.levelRecords.find((l) => l.product_id === 1).qty_on_hand = 1; // sold elsewhere meanwhile
    const movementsBefore = h.movementRecords.length;

    await expect(restoreInvoice(h.models, bill.invoice_id, admin)).rejects.toMatchObject({
      statusCode: 409,
      message: "Cannot restore: not enough stock for Hammer (needs 2, 1 available).",
    });
    expect(bill.is_deleted).toBe(true);
    expect(h.equipmentRecords[0]).toMatchObject({ available_qty: 3, rented_qty: 0 });
    expect(stockOf(h, 1)).toBe(1);
    expect(h.movementRecords).toHaveLength(movementsBefore);
    expect(h.saleLineRecords.every((l) => l.status === "voided")).toBe(true);
  });

  it("7c. restore is refused when a serial is no longer in stock", async () => {
    const h = makeShop();
    const bill = await unlistedBill(h);
    await deleteInvoice(h.models, bill.invoice_id, admin, { reason: "Created by mistake" });
    h.serialRecords[0].status = "sold"; // sold on another bill meanwhile

    await expect(restoreInvoice(h.models, bill.invoice_id, admin)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("DR-1"),
    });
    expect(bill.is_deleted).toBe(true);
    expect(h.equipmentRecords[0]).toMatchObject({ available_qty: 3, rented_qty: 0 });
    expect(stockOf(h, 1)).toBe(10);
  });

  it("7d. restore under 'warn' goes ahead even if stock runs below zero", async () => {
    const h = makeShop();
    const bill = await unlistedBill(h);
    await deleteInvoice(h.models, bill.invoice_id, admin, { reason: "Created by mistake" });
    h.levelRecords.find((l) => l.product_id === 1).qty_on_hand = 1;
    await restoreInvoice(h.models, bill.invoice_id, admin);
    expect(stockOf(h, 1)).toBe(-1);
    expect(bill.is_deleted).toBe(false);
  });

  it("8. delete is refused when goods on the bill were returned", async () => {
    const h = makeShop();
    const bill = await unlistedBill(h);
    h.saleLineRecords[0].returned_base_qty = 1;
    h.saleLineRecords[0].status = "partly_returned";

    await expect(deleteInvoice(h.models, bill.invoice_id, admin, { reason: "Created by mistake" })).rejects.toMatchObject({ statusCode: 409 });
    expect(bill.is_deleted).not.toBe(true);
    expect(h.equipmentRecords[0]).toMatchObject({ available_qty: 2, rented_qty: 1 });
    expect(stockOf(h, 1)).toBe(8);
  });

  it("9. the stock check is clean after create -> delete -> restore", async () => {
    const h = makeShop();
    // The fixture shelves start with stock but no opening movements, so give each its OPENING movement.
    for (const l of h.levelRecords) {
      h.movementRecords.push({ product_id: l.product_id, warehouse_id: l.warehouse_id, qty_change: Number(l.qty_on_hand), type: "OPENING" });
    }
    expect((await checkStockIntegrity(h.models)).ok).toBe(true);
    const bill = await unlistedBill(h);
    expect((await checkStockIntegrity(h.models)).ok).toBe(true);
    await deleteInvoice(h.models, bill.invoice_id, admin, { reason: "Created by mistake" });
    expect((await checkStockIntegrity(h.models)).ok).toBe(true);
    await restoreInvoice(h.models, bill.invoice_id, admin);
    const check = await checkStockIntegrity(h.models);
    expect(check.ok).toBe(true);
    expect(check.mismatches).toEqual([]);
  });

  it("10. a sale-only bill can be deleted and restored too, and a rental-only bill is untouched", async () => {
    const h = makeShop();
    const sale = await createDispatchInvoice(h.models, { customer_id: 5, sale_items: [{ product_id: 1, qty: 3 }], payment: { amount: 1200, method: "Cash" } }, 1);
    await deleteInvoice(h.models, sale.invoice_id, admin, { reason: "Created by mistake" });
    expect(stockOf(h, 1)).toBe(10);
    expect(h.paymentRecords.every((p) => p.is_voided)).toBe(true);
    await restoreInvoice(h.models, sale.invoice_id, admin);
    expect(stockOf(h, 1)).toBe(7);

    const rental = await createDispatchInvoice(h.models, { customer_id: 5, items: [machine()], fees: { transport: 0, discount: 0, advance: 0 } }, 1);
    const movements = h.movementRecords.length;
    await deleteInvoice(h.models, rental.invoice_id, admin, { reason: "Created by mistake" });
    expect(h.movementRecords).toHaveLength(movements);
    expect(h.equipmentRecords[0]).toMatchObject({ available_qty: 3, rented_qty: 0 });
  });
});

describe("R4-backend: reads", () => {
  it("11. the list carries items_sold_count and accepts bill_kind=mixed", async () => {
    const h = makeShop();
    await createDispatchInvoice(h.models, mixedPayload(), 1);
    await createDispatchInvoice(h.models, { customer_id: 5, items: [machine()], fees: { transport: 0, discount: 0, advance: 0 } }, 1);

    const mixed = await getAllInvoices(h.models, { bill_kind: "mixed" });
    expect(mixed.invoices).toHaveLength(1);
    expect(mixed.invoices[0].items_sold_count).toBe(2);

    const all = await getAllInvoices(h.models, {});
    expect(all.invoices.map((i) => i.items_sold_count)).toEqual([2, 0]);
  });

  it("12. the deleted-bills list shows bill_kind and sale_total", async () => {
    const h = makeShop();
    const bill = await createDispatchInvoice(h.models, mixedPayload(), 1);
    await deleteInvoice(h.models, bill.invoice_id, admin, { reason: "Created by mistake" });
    const list = await listDeletedInvoices(h.models, {});
    expect(list.invoices[0]).toMatchObject({ bill_kind: "mixed", sale_total: 950 });
  });

  it("13. splitByWeight with the machines as the first weight still adds up", () => {
    const shares = splitByWeight(10001, [100000, 80000, 20000]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10001);
  });
});
