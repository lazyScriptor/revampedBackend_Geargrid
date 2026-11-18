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
      expect(sqls[0]).toMatch(/(l\.)?track_overdue IS NULL OR (l\.)?track_overdue = TRUE/);
      // A part-returned line keeps line_status 'Active' but gets actual_return_date, so "still out"
      // must come from the quantities, not from actual_return_date IS NULL.
      expect(sqls[0]).not.toMatch(/actual_return_date IS NULL/);
      expect(sqls[0]).toMatch(/borrow_quantity - COALESCE\(l\.good_returned_qty/);
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

  it("keeps part-returned lines and shows only the units still out", async () => {
    const { models, sqls } = capture();
    await getReturnsDueToday(models, {});
    const sql = sqls.find((s) => /days_overdue/.test(s));
    expect(sql).not.toMatch(/actual_return_date IS NULL/);
    expect(sql).toMatch(/GREATEST\(0, il\.borrow_quantity - COALESCE\(il\.good_returned_qty, 0\) - COALESCE\(il\.defective_returned_qty, 0\)\) AS borrow_quantity/);
  });
});
