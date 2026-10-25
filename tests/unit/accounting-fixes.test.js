import { describe, it, expect, vi } from "vitest";
import { Op } from "sequelize";

const { computeDepreciation, getProfitAndLoss, getDashboardKPIs, getAccountsReceivable, getDailyCashFlow } = await import("../../src/services/reportService.js");
const expenseService = await import("../../src/services/expenseService.js");
const { addContinuousPayment } = await import("../../src/services/invoiceService.js");
const { getTransactionJournal, getChartData } = await import("../../src/services/accountingService.js");

const D = (s) => new Date(s);

// A fake of the tenant models that answers P&L aggregates from plain data.
const fakeFinanceModels = ({ positive = 0, negative = 0, expenseRows = [], machines = [] }) => ({
  sequelize: { query: vi.fn(async () => [{ outstanding: 0 }]), constructor: { QueryTypes: { SELECT: "SELECT" } } },
  Payment: {
    findOne: vi.fn(async ({ where }) => ({ total: where.payment_amount[Op.gt] !== undefined ? positive : -negative })),
  },
  Expense: { findAll: vi.fn(async () => expenseRows) },
  Equipment: { findAll: vi.fn(async () => machines) },
});

describe("B8 — depreciation", () => {
  const machine = { purchase_cost: 6000, createdAt: "2026-01-01T00:00:00Z" };
  it("is zero before the machine existed and after its 60-month life", () => {
    expect(computeDepreciation([machine], D("2025-01-01"), D("2025-12-31"))).toBe(0);
    expect(computeDepreciation([machine], D("2032-02-01"), D("2032-03-01"))).toBe(0);
  });
  it("≈ cost/60 per month while in service", () => {
    const v = computeDepreciation([machine], D("2026-03-01"), D("2026-04-01")); // 31 days
    expect(v).toBeGreaterThan(95);
    expect(v).toBeLessThan(105);
  });
  it("ignores machines without a cost", () => {
    expect(computeDepreciation([{ purchase_cost: 0, createdAt: "2026-01-01" }], D("2026-03-01"), D("2026-04-01"))).toBe(0);
  });
});

describe("B7/B8 — one definition of profit on Overview and P&L", () => {
  const data = { positive: 10000, negative: 1000, expenseRows: [
    { category: "Operational", total: "2000", count: 2 },
    { category: "Asset Purchase", total: "50000", count: 1 },
  ] };

  it("P&L: refunds reduce revenue; asset purchases are capital, not operating expense (no double count)", async () => {
    const r = await getProfitAndLoss(fakeFinanceModels(data), { startDate: "2026-03-01", endDate: "2026-03-31" });
    expect(r.netRevenue).toBe(9000);
    expect(r.totalExpenses).toBe(2000);
    expect(r.capitalPurchases).toBe(50000);
    expect(r.expenses.map((e) => e.category)).toEqual(["Operational"]);
    expect(r.netProfit).toBe(9000 - 2000 - r.periodDepreciation);
  });

  it("Overview KPI shows the same revenue and profit as the P&L", async () => {
    const m = fakeFinanceModels(data);
    const kpi = await getDashboardKPIs(m, { startDate: "2026-03-01", endDate: "2026-03-31" });
    const pnl = await getProfitAndLoss(m, { startDate: "2026-03-01", endDate: "2026-03-31" });
    expect(kpi.totalRevenue).toBe(pnl.netRevenue);
    expect(kpi.totalExpenses).toBe(pnl.totalExpenses);
    expect(kpi.netProfit).toBe(pnl.netProfit);
    expect(kpi.totalRefunds).toBe(1000);
  });
});

describe("B4 — receivables use days past DUE (same as the aging report)", () => {
  it("joins the earliest unreturned due date and clamps at 0", async () => {
    const sqls = [];
    const models = { sequelize: { query: vi.fn(async (sql) => { sqls.push(sql); return []; }), constructor: { QueryTypes: { SELECT: "SELECT" } } } };
    await getAccountsReceivable(models);
    expect(sqls[0]).toMatch(/earliest_due/);
    expect(sqls[0]).toMatch(/GREATEST\(0, DATEDIFF\(CURDATE\(\), COALESCE\(earliest_due\.due_date, i\.issued_date\)\)\)/);
    expect(sqls[0]).toMatch(/age_days/);
  });
});

describe("B9 — wallet usage is not cash in the drawer", () => {
  it("daily cash flow separates WalletDeposit", async () => {
    const models = { sequelize: { query: vi.fn(async () => [
      { method: "Cash", income: "500", refunds: "0", net: "500", transaction_count: "2" },
      { method: "WalletDeposit", income: "300", refunds: "0", net: "300", transaction_count: "1" },
    ]), constructor: { QueryTypes: { SELECT: "SELECT" } } } };
    const r = await getDailyCashFlow(models, { date: "2026-03-01" });
    expect(r.totals.totalNet).toBe(800);
    expect(r.totals.walletUsed).toBe(300);
    expect(r.totals.totalCashIn).toBe(500);
  });
});

describe("B6/B11 — journal & chart SQL", () => {
  const capture = () => {
    const sqls = [];
    const models = { sequelize: { query: vi.fn(async (sql) => { sqls.push(sql); return [{ total: 0 }]; }) } };
    return { models, sqls };
  };
  it("charts search never references the non-existent PAYMENTS.customer_id", async () => {
    const { models, sqls } = capture();
    await getChartData(models, { search: "kamal" });
    expect(sqls.join("\n")).not.toMatch(/p\.customer_id/);
    expect(sqls.join("\n")).toMatch(/JOIN CUSTOMERS c ON c\.customer_id = pi\.customer_id/);
  });
  it("journal reports refunds as their own type with a positive amount", async () => {
    const { models, sqls } = capture();
    await getTransactionJournal(models, { type: "refund" });
    const data = sqls.find((s) => /ORDER BY date DESC/.test(s));
    expect(data).toMatch(/CASE WHEN p\.payment_amount < 0 THEN 'refund' ELSE 'income' END as type/);
    expect(data).toMatch(/ABS\(p\.payment_amount\) as amount/);
    expect(data).toMatch(/AND type = 'refund'/);
  });
});

// ---------- expenses (B12) ----------
const fakeExpenseModels = (existing) => {
  const audit = [];
  const row = existing && { ...existing, toJSON: () => ({ ...row }), update: vi.fn(async (v) => Object.assign(row, v)), destroy: vi.fn() };
  return {
    audit,
    row,
    sequelize: { transaction: async (fn) => fn({ LOCK: { UPDATE: "UPDATE" } }) },
    Expense: {
      create: vi.fn(async (v) => ({ expense_id: 11, ...v, toJSON: () => ({ expense_id: 11, ...v }) })),
      findByPk: vi.fn(async () => row || null),
    },
    ExpenseAudit: { create: vi.fn(async (v) => audit.push(v)) },
  };
};

describe("B12 — expense validation and audit trail", () => {
  it.each([
    [{ category: "Nope", amount: 10 }, /category/i],
    [{ category: "Rent", amount: 0 }, /greater than 0/],
    [{ category: "Rent", amount: -5 }, /greater than 0/],
    [{ category: "Rent", amount: "abc" }, /greater than 0/],
    [{ category: "Rent", amount: 10, date: "not-a-date" }, /date/i],
  ])("rejects %j", async (payload, msg) => {
    await expect(expenseService.createExpense(fakeExpenseModels(), payload, 3)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(msg) });
  });

  it("accepts the extended categories and records who/what in the audit log", async () => {
    const m = fakeExpenseModels();
    await expenseService.createExpense(m, { category: "Salaries", amount: "1500.456" }, 3);
    expect(m.Expense.create.mock.calls[0][0]).toMatchObject({ category: "Salaries", amount: 1500.46, recorded_by_user_id: 3 });
    expect(m.audit[0]).toMatchObject({ action: "CREATED", actor_user_id: 3, expense_id: 11 });
  });

  it("edits and deletes are audited with the before-state", async () => {
    const m = fakeExpenseModels({ expense_id: 5, category: "Rent", amount: 100 });
    await expenseService.updateExpense(m, 5, { amount: 200 }, 8);
    expect(m.audit[0]).toMatchObject({ action: "UPDATED", actor_user_id: 8, snapshot: { before: { amount: 100 }, after: { amount: 200 } } });
    await expenseService.deleteExpense(m, 5, 8);
    expect(m.audit[1]).toMatchObject({ action: "DELETED", actor_user_id: 8 });
    expect(m.row.destroy).toHaveBeenCalled();
  });
});

// ---------- refunds & receiver (B13, B14) ----------
const fakePaymentModels = (netPaid) => ({
  sequelize: { transaction: async (fn) => fn({}) },
  Invoice: { findByPk: vi.fn(async () => ({ invoice_id: 1 })) },
  Payment: { sum: vi.fn(async () => netPaid), create: vi.fn(async (v) => v) },
  InvoiceTrace: { create: vi.fn() },
});

describe("B13/B14 — refund guard and who received the money", () => {
  it("refuses a refund bigger than what was paid", async () => {
    const m = fakePaymentModels(300);
    await expect(addContinuousPayment(m, 1, { amount: 500, method: "Cash", is_refund: true }, 4)).rejects.toMatchObject({ statusCode: 400 });
    expect(m.Payment.create).not.toHaveBeenCalled();
  });
  it("allows a refund up to the net paid and stores it negative", async () => {
    const m = fakePaymentModels(300);
    await addContinuousPayment(m, 1, { amount: 300, method: "Cash", is_refund: true }, 4);
    expect(m.Payment.create.mock.calls[0][0]).toMatchObject({ payment_amount: -300, received_by_user_id: 4 });
  });
  it("rejects zero / garbage amounts and records the cashier on payments", async () => {
    const m = fakePaymentModels(0);
    await expect(addContinuousPayment(m, 1, { amount: 0, method: "Cash" }, 4)).rejects.toMatchObject({ statusCode: 400 });
    await addContinuousPayment(m, 1, { amount: 250, method: "Card" }, 4);
    expect(m.Payment.create.mock.calls[0][0]).toMatchObject({ payment_amount: 250, received_by_user_id: 4 });
  });
});
