import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- B1: controllers must use the JWT's userId (not req.user.id, which does not exist) ----
const createDispatchInvoice = vi.fn(async () => ({ invoice_id: 1 }));
const createExpense = vi.fn(async () => ({ expense_id: 1 }));
vi.mock("../../src/services/invoiceService.js", () => ({ createDispatchInvoice }));
vi.mock("../../src/services/expenseService.js", () => ({ createExpense }));
vi.mock("../../src/config/database.js", () => ({ getCachedTenantConnection: () => ({}) }));
vi.mock("../../src/models/index.js", () => ({ initTenantModels: () => ({}) }));

const { createInvoice } = await import("../../src/controllers/invoiceController.js");
const { createExpense: createExpenseController } = await import("../../src/controllers/expenseController.js");
const { getAccountsReceivable, getDashboardKPIs } = await import("../../src/services/reportService.js");
const { getInvoiceAging } = await import("../../src/services/invoiceReportService.js");
const { owedAmount, OPEN_INVOICE_STATUSES_SQL } = await import("../../src/utils/invoiceBalance.js");

const run = (handler, req) =>
  new Promise((resolve) => {
    const res = { status: vi.fn(() => res), json: vi.fn(() => resolve(res)) };
    handler(req, res, () => resolve(res)); // catchAsync handlers are not promise-returning
  });

describe("B1 — actor attribution", () => {
  beforeEach(() => { createDispatchInvoice.mockClear(); createExpense.mockClear(); });

  it("invoice is issued by the logged-in user, not user #1", async () => {
    await run(createInvoice, { user: { userId: 42, tenantDbName: "t" }, body: { customer_id: 1, items: [], fees: {} } });
    expect(createDispatchInvoice.mock.calls[0][2]).toBe(42);
  });

  it("expense is recorded by the logged-in user, not user #1", async () => {
    await run(createExpenseController, { user: { userId: 9, tenantDbName: "t" }, body: { category: "Operational", amount: 10 } });
    expect(createExpense.mock.calls[0][2]).toBe(9);
  });
});

const captureSql = () => {
  const sqls = [];
  const models = {
    sequelize: { query: vi.fn(async (sql) => { sqls.push(sql); return [{ outstanding: 0 }]; }), constructor: { QueryTypes: { SELECT: "SELECT" } } },
    Payment: { findOne: vi.fn(async () => ({ total: 0 })) },
    Expense: { findOne: vi.fn(async () => ({ total: 0 })) },
  };
  return { models, sqls };
};

describe("B2/B3 — receivable SQL", () => {
  it("open statuses include PendingPayment (fully returned but unpaid)", () => {
    expect(OPEN_INVOICE_STATUSES_SQL).toContain("PendingPayment");
    expect(OPEN_INVOICE_STATUSES_SQL).toContain("Active");
  });

  it.each([
    ["accounts receivable", (m) => getAccountsReceivable(m)],
    ["invoice aging", (m) => getInvoiceAging(m, {})],
    ["dashboard outstanding", (m) => getDashboardKPIs(m, {})],
  ])("%s: no double-counted advance, includes PendingPayment, ignores voided payments", async (_n, call) => {
    const { models, sqls } = captureSql();
    await call(models);
    const sql = sqls.find((s) => /total_amount/.test(s) && /i\.status IN/.test(s));
    expect(sql, "owed query not found").toBeTruthy();
    expect(sql).toContain("PendingPayment");
    expect(sql).not.toMatch(/total_amount\s*-\s*i\.advance_paid/);
    expect(sql).toMatch(/is_voided\s*=\s*0/);
    expect(sql).toMatch(/is_deleted\s*=\s*0/);
  });

  it("owed = total − net payments (advance is just a payment)", () => {
    // Rs.1000 invoice, Rs.400 advance recorded as ONE payment row: 600 owed, not 200.
    expect(owedAmount(1000, [{ payment_amount: 400 }])).toBe(600);
    // later refund of 100 raises what is owed
    expect(owedAmount(1000, [{ payment_amount: 400 }, { payment_amount: -100 }])).toBe(700);
    expect(owedAmount(1000, [{ payment_amount: 1000 }])).toBe(0);
  });
});
