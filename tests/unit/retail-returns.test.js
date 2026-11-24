import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { makeSalesHarness } from "../helpers/retailHarness.js";
import { createDispatchInvoice } from "../../src/services/invoiceService.js";
import { deleteInvoice } from "../../src/services/invoiceDeletionService.js";
import { checkStockIntegrity, findReturnableSales, returnSaleLines, getRetailSettings } from "../../src/modules/retail/index.js";
import { idempotency } from "../../src/middlewares/idempotency.js";
import {
  lineNetCents,
  returnValueCents,
  returnedTotalOf,
  returnableQty,
} from "../../src/utils/saleReturnMath.js";

vi.mock("../../src/services/notificationService.js", () => ({ createNotification: vi.fn() }));
vi.mock("../../src/services/accrualService.js", () => ({ refreshAccruals: vi.fn(async () => ({})) }));
vi.mock("../../src/services/pushEventService.js", () => ({ notifyEvent: vi.fn(async () => ({ sent: 0 })) }));

const admin = { userId: 1, permissions: new Set(["*"]) };
const stockOf = (h, pid) => Number(h.levelRecords.find((l) => l.product_id === pid).qty_on_hand);
const cents = (n) => Math.round(Number(n) * 100);
const paidNet = (h, id) => h.paymentRecords.filter((p) => p.invoice_id === id).reduce((s, p) => s + Number(p.payment_amount), 0);

const makeShop = (opts = {}) => {
  const h = makeSalesHarness({
    rollback: true,
    products: [
      { product_id: 1, code: "H1", name: "Hammer", sell_price: 400, avg_cost: 250 },
      { product_id: 2, code: "B1", name: "Bolt 6mm", sell_price: 20, avg_cost: 10 },
      { product_id: 3, code: "D1", name: "Drill", sell_price: 9000, avg_cost: 6000, tracking: "serial", serial_capture: "receive" },
      { product_id: 4, code: "T1", name: "Cutting service", sell_price: 100, tracking: "service" },
      { product_id: 5, code: "U1", name: "Tape", sell_price: 50, tracking: "untracked" },
    ],
    units: [{ unit_id: 11, product_id: 2, unit_name: "box", factor: 10, sell_price: 180 }],
    levels: [
      { product_id: 1, warehouse_id: 1, qty_on_hand: 10 },
      { product_id: 2, warehouse_id: 1, qty_on_hand: 100 },
      { product_id: 3, warehouse_id: 1, qty_on_hand: 2 },
    ],
    serials: [
      { product_id: 3, serial_no: "DR-1", warehouse_id: 1 },
      { product_id: 3, serial_no: "DR-2", warehouse_id: 1 },
    ],
    customers: [
      { customer_id: 5, first_name: "Ali", deposit_balance: 0 },
      { customer_id: 9, first_name: "Walk-in", is_walk_in: true },
    ],
    ...opts,
  });
  // Give each fixture shelf its OPENING movement so the stock check has something to add up to.
  for (const l of h.levelRecords) {
    h.movementRecords.push({ product_id: l.product_id, warehouse_id: l.warehouse_id, qty_change: Number(l.qty_on_hand), type: "OPENING" });
  }
  return h;
};

const sell = (h, over = {}) =>
  createDispatchInvoice(
    h.models,
    { customer_id: 5, sale_items: [{ product_id: 1, qty: 3 }], fees: { discount: 100 }, payment: { amount: 1100 }, effectivePermissions: ["retail:add_unlisted"], ...over },
    1,
  );

const ret = (h, billId, lines, extra = {}) =>
  returnSaleLines(h.models, billId, { lines, settlement: { mode: "refund" }, userId: 1, effectivePermissions: ["retail:return"], ...extra });

describe("R5-backend: returns of sold items", () => {
  it("math: a line returned in steps refunds its net to the cent", () => {
    const line = { line_total: 1200, bill_discount_share: 100, base_qty: 3, returned_base_qty: 0, unit_factor: 1, status: "sold" };
    expect(lineNetCents(line)).toBe(110000);
    const steps = [];
    let sum = 0;
    for (let i = 0; i < 3; i += 1) {
      const v = returnValueCents({ ...line, returned_base_qty: i }, 1);
      steps.push(v);
      sum += v;
    }
    expect(steps).toEqual([36667, 36666, 36667]);
    expect(sum).toBe(110000);
    expect(returnedTotalOf([{ ...line, returned_base_qty: 3 }])).toBe(1100);
    expect(returnableQty({ ...line, returned_base_qty: 1 })).toBe(2);
  });

  it("1. partial return of a discounted line, then the rest to the cent; bill totals add up", async () => {
    const h = makeShop();
    const bill = await sell(h);
    expect(bill.total_amount).toBe(1100);
    expect(bill.status).toBe("PendingPayment"); // paid but not settled: an open bill

    const r1 = await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }]);
    expect(r1.returned_value).toBe(366.67);
    expect(r1.settlement).toMatchObject({ mode: "refund", refunded: 366.67, credited: 0 });
    expect(bill.total_amount).toBe(733.33);
    expect(bill.sale_total).toBe(733.33);
    expect(h.saleLineRecords[0]).toMatchObject({ returned_base_qty: 1, status: "partly_returned" });

    await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }]);
    const r3 = await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }]);
    expect(r3.returned_value).toBe(366.67);
    expect(h.saleLineRecords[0]).toMatchObject({ returned_base_qty: 3, status: "returned" });
    expect(bill.total_amount).toBe(0);
    expect(bill.sale_total).toBe(0);
    expect(Math.abs(cents(paidNet(h, bill.invoice_id)))).toBe(0); // 1100 paid, 1100 refunded to the cent
    expect(bill.status).toBe("Completed"); // sale-only, balance 0
    expect((await checkStockIntegrity(h.models)).ok).toBe(true);
  });

  it("2. good return: SALE_RETURN at the line's own cost; a later receive keeps avg_cost right", async () => {
    const h = makeShop();
    const bill = await sell(h);
    h.prodRecords[0].avg_cost = 300; // the average moved after the sale
    await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1, condition: "good" }]);
    const mv = h.movementRecords.find((m) => m.type === "SALE_RETURN");
    expect(mv).toMatchObject({ product_id: 1, qty_change: 1, unit_cost: 250, sale_line_id: 1 });
    expect(h.prodRecords[0].avg_cost).toBe(300); // a return does not touch the average
    expect(stockOf(h, 1)).toBe(8);
    expect((await checkStockIntegrity(h.models)).ok).toBe(true);
  });

  it("3. damaged return: SALE_RETURN + ADJUST_OUT 'damaged'; shelf unchanged overall", async () => {
    const h = makeShop();
    const bill = await sell(h);
    expect(stockOf(h, 1)).toBe(7);
    await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 2, condition: "damaged" }]);
    const types = h.movementRecords.filter((m) => m.type !== "OPENING" && m.type !== "SALE").map((m) => [m.type, m.qty_change, m.reason, m.unit_cost]);
    expect(types).toEqual([
      ["SALE_RETURN", 2, null, 250],
      ["ADJUST_OUT", -2, "damaged", 250],
    ]);
    expect(stockOf(h, 1)).toBe(7);
    expect((await checkStockIntegrity(h.models)).ok).toBe(true);
  });

  it("4. serials: good goes in_stock, damaged is written_off, a wrong serial is refused", async () => {
    const h = makeShop();
    const bill = await sell(h, {
      sale_items: [{ product_id: 3, qty: 1, serial_number: "DR-1" }, { product_id: 3, qty: 1, serial_number: "DR-2" }],
      fees: {},
      payment: { amount: 18000 },
    });
    const serial = (n) => h.serialRecords.find((s) => s.serial_no === n);
    expect(serial("DR-1").status).toBe("sold");

    await expect(ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1, serial_no: "DR-2" }])).rejects.toMatchObject({ statusCode: 409, code: "wrong_serial" });
    expect(serial("DR-1").status).toBe("sold");
    expect(h.saleLineRecords[0].returned_base_qty ?? 0).toBe(0);

    await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1, serial_no: "DR-1", condition: "good" }]);
    expect(serial("DR-1")).toMatchObject({ status: "in_stock", sale_line_id: null, sold_at: null, warranty_end: null });
    await ret(h, bill.invoice_id, [{ sale_line_id: 2, qty: 1, condition: "damaged" }]);
    expect(serial("DR-2").status).toBe("written_off");
    expect(stockOf(h, 3)).toBe(1);
    expect((await checkStockIntegrity(h.models)).ok).toBe(true);
  });

  it("5. a pack line returned in single pieces; more than returnable is 409", async () => {
    const h = makeShop();
    const bill = await sell(h, { sale_items: [{ product_id: 2, qty: 2, unit_id: 11 }], fees: {}, payment: { amount: 360 } });
    expect(Number(h.saleLineRecords[0].base_qty)).toBe(20);
    const r = await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 5, unit_id: null }]);
    expect(r.returned_value).toBe(90);
    expect(Number(h.saleLineRecords[0].returned_base_qty)).toBe(5);
    expect(stockOf(h, 2)).toBe(85);

    // 15 base pieces left = 1.5 boxes
    await expect(ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 2 }])).rejects.toMatchObject({
      statusCode: 409,
      code: "return_exceeds_sold",
      data: { returnable_base_qty: 15, returnable_qty: 1.5 },
    });
    await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1, unit_id: 11 }]); // one whole box
    expect(Number(h.saleLineRecords[0].returned_base_qty)).toBe(15);
    expect((await checkStockIntegrity(h.models)).ok).toBe(true);
  });

  it("6. untracked, service, unlisted and sundry lines take no stock", async () => {
    const h = makeShop();
    const bill = await sell(h, {
      sale_items: [
        { product_id: 4, qty: 1 },
        { product_id: 5, qty: 2 },
        { line_kind: "unlisted", description: "Black tape", unit_price: 30, qty: 1 },
        { line_kind: "sundry", description: "Fixing", unit_price: 70, qty: 1 },
      ],
      fees: {},
      payment: { amount: 300 },
    });
    const before = h.movementRecords.length;
    const r = await ret(h, bill.invoice_id, h.saleLineRecords.map((l) => ({ sale_line_id: l.sale_line_id, qty: Number(l.qty) })));
    expect(r.returned_value).toBe(300);
    expect(h.movementRecords).toHaveLength(before);
    expect(bill.status).toBe("Completed");
  });

  it("7. Completed bill: refund equals the value, credit refused, bill stays Completed", async () => {
    const h = makeShop();
    const bill = await sell(h, { settle_now: true });
    expect(bill.status).toBe("Completed");

    await expect(ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }], { settlement: { mode: "credit" } })).rejects.toMatchObject({
      statusCode: 409,
      message: "This bill is closed: refund the return, or reopen the bill to keep it as credit.",
    });
    await expect(ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }], { settlement: { mode: "refund", amount: 100 } })).rejects.toMatchObject({
      statusCode: 409,
      code: "refund_must_equal_return",
    });
    expect(h.paymentRecords).toHaveLength(1);

    const r = await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }], { settlement: { mode: "refund", method: "Card" } });
    expect(r.settlement.refunded).toBe(366.67);
    expect(h.paymentRecords[1]).toMatchObject({ payment_amount: -366.67, method: "Card" });
    expect(bill.status).toBe("Completed");
    expect(cents(bill.total_amount) - cents(paidNet(h, bill.invoice_id))).toBe(0);
    // the mode may be left out on a closed bill
    await returnSaleLines(h.models, bill.invoice_id, { lines: [{ sale_line_id: 1, qty: 1 }], userId: 1 });
    expect(h.paymentRecords).toHaveLength(3);
  });

  it("8. open bill: credit lowers the balance; refund is capped at what was paid beyond the new total", async () => {
    const h = makeShop();
    const bill = await sell(h, { payment: { amount: 500 } }); // total 1100, paid 500
    // refund 366.67 would leave 733.33 owed with 500 paid: nothing to refund
    await expect(ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }])).rejects.toMatchObject({
      statusCode: 409,
      code: "refund_exceeds_paid",
      data: { max_refund: 0 },
    });
    expect(h.paymentRecords).toHaveLength(1);

    const r = await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }], { settlement: { mode: "credit" } });
    expect(r.settlement).toMatchObject({ mode: "credit", refunded: 0, credited: 366.67, payment_id: null });
    expect(bill.total_amount).toBe(733.33);
    expect(r.balance).toBe(233.33);
    expect(bill.status).toBe("PendingPayment");
    expect(h.paymentRecords).toHaveLength(1);

    // another return: total would be 366.66 with 500 paid, so at most 133.34 can go back
    await expect(
      ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }], { settlement: { mode: "refund", amount: 200 } }),
    ).rejects.toMatchObject({ code: "refund_exceeds_paid", data: { max_refund: 133.33 } });
    const r3 = await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }], { settlement: { mode: "refund", amount: 133.33 } });
    expect(r3).toMatchObject({ balance: 0, settlement: { refunded: 133.33, credited: 233.33 } });
    expect(bill.status).toBe("Completed");
  });

  it("9. the walk-in customer can never keep credit; a WalletDeposit refund goes back to the wallet", async () => {
    const h = makeShop();
    const walk = await sell(h, { customer_id: 9, walk_in: true, settle_now: true });
    await expect(ret(h, walk.invoice_id, [{ sale_line_id: 1, qty: 1 }], { settlement: { mode: "credit" } })).rejects.toMatchObject({ statusCode: 409 });

    const named = await sell(h, { settle_now: true });
    const wallet = h.customerRecords.find((c) => c.customer_id === 5);
    await ret(h, named.invoice_id, [{ sale_line_id: 2, qty: 1 }], { settlement: { mode: "refund", method: "WalletDeposit" } });
    expect(wallet.deposit_balance).toBe(366.67);
  });

  it("10. a sale-only PendingPayment bill reaching balance 0 becomes Completed (with a trace); a mixed bill keeps its status", async () => {
    const h = makeShop({ equipment: [{ equipment_id: 1, equipment_name: "Breaker", available_qty: 3, total_owned_qty: 3 }] });
    const bill = await sell(h, { payment: { amount: 366.67 } }); // owes 733.33
    const r = await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 2 }], { settlement: { mode: "credit" } });
    expect(r.balance).toBe(0);
    expect(bill.status).toBe("Completed");
    const completed = h.models.InvoiceTrace.create.mock.calls.map((c) => c[0]).filter((t) => t.event_action === "INVOICE_COMPLETED");
    expect(completed.length).toBeGreaterThan(0);

    const mixed = await createDispatchInvoice(
      h.models,
      {
        customer_id: 5,
        items: [{ equipment_id: 1, borrow_date: "2026-11-20", expected_return_date: "2026-11-21", locked_base_price: 1000, locked_minimum_days: 1, locked_extra_daily_rate: 500, borrow_quantity: 1 }],
        sale_items: [{ product_id: 1, qty: 1 }],
        fees: { transport: 0, discount: 0, advance: 1400 },
      },
      1,
    );
    expect(mixed.status).toBe("Active");
    await ret(h, mixed.invoice_id, [{ sale_line_id: h.saleLineRecords.at(-1).sale_line_id, qty: 1 }], { settlement: { mode: "refund" } });
    expect(mixed.status).toBe("Active");
    expect(mixed.bill_kind).toBe("mixed");
    expect(mixed.rental_total).toBe(1000);
  });

  it("11. returnDaysLimit: a late return with no reason needs approval; with a reason it is recorded", async () => {
    const h = makeShop({ retailSettings: { returnDaysLimit: 30 } });
    const bill = await sell(h, { settle_now: true });
    bill.issued_date = new Date(Date.now() - 45 * 86400000);

    await expect(ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }])).rejects.toMatchObject({ statusCode: 403, code: "return_approval_required" });
    expect(h.paymentRecords).toHaveLength(1);

    // a token for too small a value is refused
    const small = h.issueApprovalToken({ action: "return_no_bill", context: { invoice_id: bill.invoice_id, value: 100 } });
    await expect(ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }], { approval_tokens: { return_no_bill: small } })).rejects.toMatchObject({ statusCode: 403 });

    const token = h.issueApprovalToken({ action: "return_no_bill", context: { invoice_id: bill.invoice_id, value: 400 } });
    await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }], { approval_tokens: { return_no_bill: token } });
    expect(h.exceptionRecords.filter((e) => e.type === "return_no_bill").map((e) => e.status)).toEqual(["approved"]);

    await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }], { reason: "Wrong size" });
    expect(h.exceptionRecords.filter((e) => e.type === "return_no_bill").map((e) => e.status)).toEqual(["approved", "recorded"]);

    // inside the limit: nothing recorded
    const fresh = await sell(h, { settle_now: true });
    await ret(h, fresh.invoice_id, [{ sale_line_id: fresh.invoice_id === bill.invoice_id ? 1 : 2, qty: 1 }]);
    expect(h.exceptionRecords.filter((e) => e.type === "return_no_bill")).toHaveLength(2);
    expect((await getRetailSettings(h.models)).returnDaysLimit).toBe(30);
  });

  it("12. an idempotent double submit refunds once", async () => {
    const h = makeShop();
    const bill = await sell(h, { settle_now: true });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { userId: 1, tenantDbName: "geargrid_test" };
      req.tenantModels = h.models;
      next();
    });
    app.post("/api/invoices/:id/sale-returns", idempotency(), async (req, res, next) => {
      try {
        const result = await returnSaleLines(h.models, Number(req.params.id), { ...req.body, userId: 1 });
        res.status(200).json({ status: "success", data: result });
      } catch (err) {
        next(err);
      }
    });
    const body = { lines: [{ sale_line_id: 1, qty: 1 }], settlement: { mode: "refund" } };
    const url = `/api/invoices/${bill.invoice_id}/sale-returns`;
    const a = await request(app).post(url).set("Idempotency-Key", "ret-1").send(body);
    const b = await request(app).post(url).set("Idempotency-Key", "ret-1").send(body);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(h.paymentRecords.filter((p) => Number(p.payment_amount) < 0)).toHaveLength(1);
    expect(Number(h.saleLineRecords[0].returned_base_qty)).toBe(1);
  });

  it("13. delete is refused after a return, and the stock check stays clean", async () => {
    const h = makeShop();
    const bill = await sell(h, { settle_now: true });
    await ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }]);
    await expect(deleteInvoice(h.models, bill.invoice_id, admin, { reason: "Created by mistake" })).rejects.toMatchObject({ statusCode: 409 });
    expect((await checkStockIntegrity(h.models)).ok).toBe(true);
  });

  it("14. input errors change nothing; a failed return rolls back", async () => {
    const h = makeShop();
    const bill = await sell(h, { settle_now: true });
    await expect(ret(h, bill.invoice_id, [])).rejects.toMatchObject({ statusCode: 400 });
    await expect(ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 0 }])).rejects.toMatchObject({ statusCode: 400 });
    await expect(ret(h, bill.invoice_id, [{ sale_line_id: 99, qty: 1 }])).rejects.toMatchObject({ statusCode: 404 });
    await expect(ret(h, 9999, [{ sale_line_id: 1, qty: 1 }])).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      returnSaleLines(h.models, bill.invoice_id, { lines: [{ sale_line_id: 1, qty: 1 }], userId: 1, effectivePermissions: ["retail:sell"] }),
    ).rejects.toMatchObject({ statusCode: 403 });
    // a second line that is too big takes the first one down with it
    await expect(
      ret(h, bill.invoice_id, [{ sale_line_id: 1, qty: 1 }, { sale_line_id: 1 + 100, qty: 1 }]),
    ).rejects.toBeTruthy();
    expect(Number(h.saleLineRecords[0].returned_base_qty || 0)).toBe(0);
    expect(bill.total_amount).toBe(1100);
    expect(stockOf(h, 1)).toBe(7);
  });

  it("15. find: recent returnable lines by item, customer or bill number", async () => {
    const h = makeShop();
    h.models.sequelize.where = vi.fn(() => ({}));
    h.models.sequelize.col = vi.fn((c) => c);
    h.models.InvoiceSaleLine.findAll.mockImplementationOnce(async (q) => {
      expect(q.limit).toBe(30);
      expect(q.order).toEqual([["sale_line_id", "DESC"]]);
      return [
        {
          sale_line_id: 7, invoice_id: 12, product_id: 1, description: "Hammer", unit_label: "pcs", qty: 3, base_qty: 3,
          returned_base_qty: 1, unit_factor: 1, unit_price: 400, line_total: 1200, bill_discount_share: 100, status: "partly_returned",
          Invoice: { invoice_id: 12, issued_date: new Date(), status: "Completed", customer_id: 5, Customer: { first_name: "Ali", last_name: "Perera", phone_number: "0771234567" } },
        },
      ];
    });
    const { items } = await findReturnableSales(h.models, { q: "hammer", days: 90 });
    expect(items).toEqual([
      expect.objectContaining({ sale_line_id: 7, invoice_id: 12, customer_name: "Ali Perera", qty_sold: 3, returnable_qty: 2, unit_price: 400, net_total: 1100 }),
    ]);
  });
});
