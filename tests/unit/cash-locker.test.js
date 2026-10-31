import { describe, it, expect, vi } from "vitest";
import { Op } from "sequelize";
import {
  heldAdvances,
  buildMovements,
  drawerChange,
  getStatus,
  recordOpening,
  recordClosing,
  startLocker,
  changePaymentMethod,
  DEFAULT_FLOAT,
} from "../../src/services/cashLockerService.js";

vi.mock("../../src/sockets/emitters.js", () => ({ emitToUser: vi.fn(), emitToTenant: vi.fn() }));

const row = (data) => ({ ...data, toJSON: () => data, update: vi.fn(async (p) => Object.assign(data, p)) });
const at = (s) => new Date(`${s}+05:30`);

/** In-memory tenant: invoices with payments/lines, locker expenses, counts, owners. */
const buildModels = ({ invoices = [], payments = [], expenses = [], counts = [], float } = {}) => {
  const notifications = [];
  const traces = [];
  const config = row({ timezone: "Asia/Colombo", custom_settings: float === undefined ? null : { cash_locker: { float } } });
  const after = (where, field) => (where?.[field]?.[Op.gt] ? (x) => new Date(x[field]) > new Date(where[field][Op.gt]) : () => true);
  const invoiceView = (inv) => ({
    ...inv,
    Payments: payments.filter((p) => p.invoice_id === inv.invoice_id),
    Customer: { first_name: inv.customer, last_name: "" },
    InvoiceLines: inv.lines || [],
  });
  return {
    _notifications: notifications,
    _traces: traces,
    _counts: counts,
    _invoices: invoices,
    sequelize: { transaction: async (fn) => fn({}) },
    TenantConfig: { findOne: vi.fn(async () => config), create: vi.fn() },
    CashLockerCount: {
      findOne: vi.fn(async () => [...counts].sort((a, b) => new Date(b.counted_at) - new Date(a.counted_at))[0] || null),
      findAll: vi.fn(async ({ where }) => counts.filter((c) => c.business_date === where.business_date)),
      create: vi.fn(async (data) => {
        const r = row({ count_id: counts.length + 1, ...data });
        counts.push(r);
        return r;
      }),
    },
    Invoice: {
      findAll: vi.fn(async () =>
        invoices
          .filter((i) => i.status !== "Completed" && !i.advance_at_home && Number(i.advance_paid) > 0)
          .map((i) => row(invoiceView(i))),
      ),
      update: vi.fn(async (patch, { where }) => invoices.filter((i) => where.invoice_id.includes(i.invoice_id)).forEach((i) => Object.assign(i, patch))),
    },
    Payment: {
      findAll: vi.fn(async ({ where }) =>
        payments
          .filter((p) => !p.is_voided)
          .filter(after(where, "payment_date"))
          .map((p) => row({ ...p, Invoice: { invoice_id: p.invoice_id, Customer: { first_name: invoices.find((i) => i.invoice_id === p.invoice_id)?.customer } } })),
      ),
      findByPk: vi.fn(async (id) => {
        const p = payments.find((x) => x.payment_id === Number(id));
        return p ? row(p) : null;
      }),
    },
    Expense: { findAll: vi.fn(async ({ where }) => expenses.filter(after(where, "createdAt")).map(row)) },
    User: {
      findAll: vi.fn(async ({ include }) =>
        include ? [row({ user_id: 1, first_name: "Owner", last_name: "", phone_number: "0777593701" })] : [],
      ),
    },
    Role: {},
    Permission: {},
    Customer: {},
    InvoiceLine: {},
    InvoiceTrace: { create: vi.fn(async (d) => traces.push(d)) },
    Notification: { create: vi.fn(async (d) => { const r = row({ notification_id: notifications.length + 1, ...d }); notifications.push(r); return r; }) },
  };
};

const pay = (payment_id, invoice_id, amount, method, when, extra = {}) => ({ payment_id, invoice_id, payment_amount: amount, method, payment_date: at(when), is_voided: false, ...extra });

describe("pure drawer maths", () => {
  it("holds cash advances only, minus cash refunds, and flags invoices whose machines are all back", () => {
    const held = heldAdvances([
      { invoice_id: 1, advance_paid: 5000, Payments: [pay(1, 1, 5000, "Cash", "2026-11-01T09:00:00", { is_advance: true })], InvoiceLines: [{ line_status: "Active" }] },
      { invoice_id: 2, advance_paid: 3000, Payments: [pay(2, 2, 3000, "Transfer", "2026-11-01T10:15:00", { is_advance: true })] },
      { invoice_id: 3, advance_paid: 2000, Payments: [pay(3, 3, 2000, "Cash", "2026-11-01T11:00:00"), pay(4, 3, -500, "Cash", "2026-11-02T12:00:00")], InvoiceLines: [{ line_status: "Returned" }] },
    ]);
    expect(held.map((h) => [h.invoice_id, h.held, h.all_back])).toEqual([
      [1, 5000, false],
      [3, 1500, true], // old invoice: first payment is the advance
    ]);
  });

  it("only cash moves the drawer", () => {
    const m = buildMovements(
      [pay(1, 1, 5000, "Cash", "2026-11-01T09:00:00", { is_advance: true }), pay(2, 2, 3000, "Transfer", "2026-11-01T10:00:00"), pay(3, 1, -1000, "Cash", "2026-11-01T11:00:00")],
      [{ expense_id: 9, amount: 400, createdAt: at("2026-11-01T13:00:00") }],
    );
    expect(m.map((x) => x.type)).toEqual(["advance", "payment", "refund", "expense"]);
    expect(drawerChange(m)).toBe(5000 - 1000 - 400);
  });
});

describe("the worked example: day 1 and day 2", () => {
  const start = { kind: "START", business_date: "2026-11-01", counted_at: at("2026-11-01T08:30:00"), left_in_drawer: 1500 };

  it("day 1 evening: the payment saved as Cash by mistake shows Rs 4,000 short; fixed, Rs 200 goes home", async () => {
    const invoices = [
      { invoice_id: 101, customer: "Nimal", status: "Active", advance_paid: 5000 },
      { invoice_id: 102, customer: "Saman", status: "Active", advance_paid: 3000 },
      { invoice_id: 103, customer: "Kamal", status: "Active", advance_paid: 2000 },
      { invoice_id: 104, customer: "Ruwan", status: "Completed", advance_paid: 0 },
      { invoice_id: 105, customer: "Fernando", status: "Active", advance_paid: 4000 },
    ];
    const payments = [
      pay(1, 101, 5000, "Cash", "2026-11-01T09:00:00", { is_advance: true }),
      pay(2, 102, 3000, "Transfer", "2026-11-01T10:15:00", { is_advance: true }),
      pay(3, 103, 2000, "Cash", "2026-11-01T11:00:00", { is_advance: true }),
      pay(4, 104, 600, "Cash", "2026-11-01T15:00:00"),
      pay(5, 105, 4000, "Cash", "2026-11-01T16:30:00", { is_advance: true }), // really a bank transfer
    ];
    const expenses = [{ expense_id: 1, amount: 400, createdAt: at("2026-11-01T13:00:00"), paid_from_locker: true }];
    const models = buildModels({ invoices, payments, expenses, counts: [row({ ...start })] });
    const now = at("2026-11-01T18:00:00");

    let s = await getStatus(models, { now });
    expect(s.float).toBe(DEFAULT_FLOAT);
    expect(s.expected_now).toBe(12700);
    await expect(recordClosing(models, { counted: 8700, userId: 2, now })).rejects.toThrow(/4,000 short/);

    await changePaymentMethod(models, { paymentId: 5, method: "Transfer", userId: 2 });
    expect(models._traces[0].event_action).toBe("PAYMENT_METHOD_CHANGED");

    s = await getStatus(models, { now });
    expect(s.expected_now).toBe(8700);
    expect(s.keep).toBe(8500);
    expect(s.send_home).toBe(200);

    const { count } = await recordClosing(models, { counted: 8700, userId: 2, now });
    expect(count.sent_home).toBe(200);
    expect(count.left_in_drawer).toBe(8500);
    expect(count.difference).toBe(0);
    expect(models._notifications[0].title).toMatch(/Rs. 200 sent home/);
  });

  it("day 2: 24.5h rental refund, LankaQR advance ignored, partial payment keeps the advance, Rs 100 short with a reason", async () => {
    const invoices = [
      { invoice_id: 101, customer: "Nimal", status: "Completed", advance_paid: 5000 },
      { invoice_id: 103, customer: "Kamal", status: "PendingPayment", advance_paid: 2000, lines: [{ line_status: "Returned" }] },
      { invoice_id: 105, customer: "Fernando", status: "Completed", advance_paid: 4000 },
      { invoice_id: 106, customer: "Perera", status: "Active", advance_paid: 6000 },
    ];
    const payments = [
      pay(1, 101, 5000, "Cash", "2026-11-01T09:00:00", { is_advance: true }),
      pay(3, 103, 2000, "Cash", "2026-11-01T11:00:00", { is_advance: true }),
      pay(5, 105, 4000, "Transfer", "2026-11-01T16:30:00", { is_advance: true }),
      pay(10, 101, -1000, "Cash", "2026-11-02T09:30:00"),
      pay(11, 103, 500, "Cash", "2026-11-02T12:00:00"),
      pay(12, 106, 6000, "Cash", "2026-11-02T13:30:00", { is_advance: true }),
      pay(13, 105, -500, "Cash", "2026-11-02T15:00:00"),
    ];
    const expenses = [{ expense_id: 2, amount: 1200, createdAt: at("2026-11-02T14:00:00"), paid_from_locker: true }];
    const counts = [
      row({ ...start }),
      row({ kind: "CLOSING", business_date: "2026-11-01", counted_at: at("2026-11-01T18:00:00"), left_in_drawer: 8500 }),
      row({ kind: "OPENING", business_date: "2026-11-02", counted_at: at("2026-11-02T08:30:00"), left_in_drawer: 8500 }),
    ];
    const models = buildModels({ invoices, payments, expenses, counts });
    const now = at("2026-11-02T18:00:00");

    const s = await getStatus(models, { now });
    expect(s.expected_now).toBe(12300);
    expect(s.held.map((h) => [h.invoice_id, h.held, h.all_back])).toEqual([
      [103, 2000, true], // Kamal: machine back, invoice still open
      [106, 6000, false],
    ]);
    expect(s.keep).toBe(9500);

    await expect(recordClosing(models, { counted: 12200, userId: 2, now })).rejects.toThrow(/Rs. 100 short/);
    const { count } = await recordClosing(models, { counted: 12200, reason: "gave wrong change, I think", userId: 2, now });
    expect(count.difference).toBe(-100);
    expect(count.sent_home).toBe(2700);
    expect(count.left_in_drawer).toBe(9500);
    expect(models._notifications[0].type).toBe("warning");
  });
});

describe("opening", () => {
  it("compares the morning count with what was left last night and tells the owner", async () => {
    const counts = [row({ kind: "CLOSING", business_date: "2026-11-01", counted_at: at("2026-11-01T18:00:00"), left_in_drawer: 9500 })];
    const models = buildModels({ counts });
    const { count, owner_whatsapp } = await recordOpening(models, { amount: 9000, userId: 2, userLabel: "Kamal", now: at("2026-11-02T09:12:00") });
    expect(count.expected_amount).toBe(9500);
    expect(count.difference).toBe(-500);
    expect(owner_whatsapp).toBe("94777593701");
    expect(models._notifications[0].title).toBe("Locker opened: Rs. 9,000");
    expect(models._notifications[0].message).toMatch(/Kamal counted at 9:12 AM. Expected Rs. 9,500: Rs. 500 short/);
    await expect(recordOpening(models, { amount: 9000, userId: 2, now: at("2026-11-02T10:00:00") })).rejects.toThrow(/already entered/);
  });

  it("is refused before the owner starts the locker", async () => {
    await expect(recordOpening(buildModels(), { amount: 1500, userId: 2 })).rejects.toThrow(/not been started/);
  });
});

describe("one-time start in the middle of the month", () => {
  const fresh = () => ({
    invoices: [
      { invoice_id: 50, customer: "Old A", status: "Active", advance_paid: 3000 },
      { invoice_id: 51, customer: "Old B", status: "Active", advance_paid: 2000 },
    ],
    payments: [
      pay(1, 50, 3000, "Cash", "2026-10-20T10:00:00", { is_advance: true }),
      pay(2, 51, 2000, "Cash", "2026-10-22T10:00:00", { is_advance: true }),
    ],
  });

  it("advances already at home leave keep; extra cash is sent home", async () => {
    const models = buildModels(fresh());
    const { count } = await startLocker(models, { counted: 6000, at_home_invoice_ids: [51], userId: 1, now: at("2026-11-01T19:00:00") });
    expect(models._invoices.find((i) => i.invoice_id === 51).advance_at_home).toBe(true);
    expect(count.keep_amount).toBe(4500); // 1,500 + 3,000
    expect(count.sent_home).toBe(1500);
    expect(count.left_in_drawer).toBe(4500);
    expect(count.difference).toBe(0);
  });

  it("a shortfall needs a note, and it can only start once", async () => {
    const models = buildModels(fresh());
    await expect(startLocker(models, { counted: 5000, userId: 1 })).rejects.toThrow(/short/);
    await startLocker(models, { counted: 5000, reason: "old refund paid from the drawer", userId: 1, now: at("2026-11-01T19:00:00") });
    expect(models._counts[0].difference).toBe(-1500);
    await expect(startLocker(models, { counted: 5000, userId: 1 })).rejects.toThrow(/already running/);
  });
});

describe("fixing a payment method", () => {
  it("only payments taken since the last count can be changed", async () => {
    const payments = [pay(1, 1, 500, "Cash", "2026-11-01T10:00:00"), pay(2, 1, 500, "Cash", "2026-11-02T10:00:00")];
    const counts = [row({ kind: "CLOSING", business_date: "2026-11-01", counted_at: at("2026-11-01T18:00:00"), left_in_drawer: 1500 })];
    const models = buildModels({ payments, counts });
    await expect(changePaymentMethod(models, { paymentId: 1, method: "Card", userId: 2 })).rejects.toThrow(/already counted/);
    await expect(changePaymentMethod(models, { paymentId: 2, method: "Bitcoin", userId: 2 })).rejects.toThrow(/Choose one of/);
    await changePaymentMethod(models, { paymentId: 2, method: "Card", userId: 2 });
    expect(payments[1].method).toBe("Card");
  });
});
