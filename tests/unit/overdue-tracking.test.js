import { describe, it, expect, vi } from "vitest";

const { getReturnsDueToday } = await import("../../src/services/dashboardService.js");
const { getAccountsReceivable } = await import("../../src/services/reportService.js");
const { getInvoiceAging } = await import("../../src/services/invoiceReportService.js");

const capture = () => {
  const sqls = [];
  const models = { sequelize: { query: vi.fn(async (sql) => { sqls.push(sql); return []; }), constructor: { QueryTypes: { SELECT: "SELECT" } } } };
  return { models, sqls };
};

describe("overdue is only about lines whose return date is tracked", () => {
  it("receivables and aging take the due date only from tracked lines", async () => {
    for (const run of [(m) => getAccountsReceivable(m), (m) => getInvoiceAging(m, {})]) {
      const { models, sqls } = capture();
      await run(models);
      expect(sqls[0]).toMatch(/earliest_due/);
      expect(sqls[0]).toMatch(/track_overdue IS NULL OR track_overdue = TRUE/);
    }
  });
});

describe("dashboard overdue list", () => {
  it("ignores lines whose return date is not tracked (they have no real due date)", async () => {
    const { models, sqls } = capture();
    await getReturnsDueToday(models, {});
    const sql = sqls.find((s) => /days_overdue/.test(s));
    expect(sql).toMatch(/il\.expected_return_date <= CURDATE\(\)/);
    expect(sql).toMatch(/il\.track_overdue IS NULL OR il\.track_overdue = TRUE/);
  });
});
