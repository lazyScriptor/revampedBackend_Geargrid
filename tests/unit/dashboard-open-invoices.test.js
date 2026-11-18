import { describe, it, expect, vi } from "vitest";
import {
  getOpenInvoices,
  WIDGET_CATALOG,
  DEFAULT_LAYOUT,
} from "../../src/services/dashboardService.js";

const buildFakeModels = ({ mainRows = [], itemRows = [] } = {}) => {
  const sqls = [];
  const calls = [];
  const models = {
    sequelize: {
      constructor: { QueryTypes: { SELECT: "SELECT" } },
      query: vi.fn(async (sql, opts) => {
        sqls.push(sql);
        calls.push({ sql, replacements: opts?.replacements || {} });
        if (sql.includes("FROM INVOICES i")) {
          return mainRows;
        }
        return itemRows;
      }),
    },
  };
  return { models, sqls, calls };
};

describe("dashboardService.getOpenInvoices", () => {
  it("validates query parameters and rejects bad inputs with 400", async () => {
    const { models } = buildFakeModels();

    await expect(getOpenInvoices(models, { view: "other" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(getOpenInvoices(models, { view: "money", olderThanDays: 5 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(getOpenInvoices(models, { view: "money", olderThanDays: "7abc" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(getOpenInvoices(models, { view: "money", limit: 0 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(getOpenInvoices(models, { view: "money", limit: 101 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(getOpenInvoices(models, { view: "returns", onlyOverdue: "yes" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(getOpenInvoices(models, { view: "money", warehouseId: "bad" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("uses invoiceBalance helpers, track_overdue guard, and tenant date replacement", async () => {
    const { models, calls } = buildFakeModels({ mainRows: [] });

    await getOpenInvoices(models, {
      view: "money",
      olderThanDays: 7,
      warehouseId: 2,
      tenantTz: "Asia/Colombo",
    });

    expect(calls).toHaveLength(1);
    const { sql, replacements } = calls[0];
    expect(sql).toMatch(/\('Active', 'PendingPayment'\)/);
    expect(sql).toMatch(/is_voided = 0/);
    expect(sql).toMatch(/accrued_charges/);
    expect(sql).toMatch(/track_overdue IS NULL OR il\.track_overdue = TRUE/);
    expect(sql).toMatch(/warehouse_id = :warehouseId/);
    expect(replacements.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(replacements.warehouseId).toBe(2);
  });

  it("computes summary, buckets, sorting, age filtering, and items_out grouping for view=money", async () => {
    const sampleRows = [
      // age 2, unpaid + items out -> appears in 0_7 bucket; filtered out by olderThanDays=7
      {
        invoice_id: 101,
        issued_date: "2026-11-16",
        age_days: 2,
        status: "Active",
        customer_id: 1,
        first_name: "Kamal",
        last_name: "Perera",
        company_name: null,
        customer_type: "Individual",
        phone_number: "0771111111",
        live_total: 5200,
        paid: 0,
        owed: 5200,
        accrued_charges: 200,
        units_out: 2,
        earliest_due_date: "2026-11-18",
        days_overdue: 0,
      },
      // age 10, unpaid only (PendingPayment, all back)
      {
        invoice_id: 102,
        issued_date: "2026-11-08",
        age_days: 10,
        status: "PendingPayment",
        customer_id: 2,
        first_name: "Nimal",
        last_name: "Silva",
        company_name: "Silva Builders",
        customer_type: "Business",
        phone_number: "0772222222",
        live_total: 25000,
        paid: 5000,
        owed: 20000,
        accrued_charges: 0,
        units_out: 0,
        earliest_due_date: null,
        days_overdue: 0,
      },
      // age 20, unpaid + items out (lower owed than 102, but higher risk -> must sort FIRST!)
      {
        invoice_id: 103,
        issued_date: "2026-10-29",
        age_days: 20,
        status: "Active",
        customer_id: 3,
        first_name: "Saman",
        last_name: "Kumara",
        company_name: null,
        customer_type: "Individual",
        phone_number: null,
        live_total: 12000,
        paid: 2000,
        owed: 10000,
        accrued_charges: 1500,
        units_out: 4,
        earliest_due_date: "2026-11-11",
        days_overdue: 7,
      },
      // age 95, paid in full, items still out -> must NOT appear in money rows, DOES appear in returns
      {
        invoice_id: 104,
        issued_date: "2026-08-15",
        age_days: 95,
        status: "Active",
        customer_id: 4,
        first_name: "Ruwan",
        last_name: "Jay",
        company_name: null,
        customer_type: "Individual",
        phone_number: "0774444444",
        live_total: 4000,
        paid: 4000,
        owed: 0,
        accrued_charges: 0,
        units_out: 3,
        earliest_due_date: "2026-11-18",
        days_overdue: 0,
      },
    ];

    const sampleItems = [
      { invoice_id: 103, name: "Scaffolding (3*5)", qty: 3 },
      { invoice_id: 103, name: "Concrete Mixer", qty: 1 },
    ];

    const { models, calls } = buildFakeModels({
      mainRows: sampleRows,
      itemRows: sampleItems,
    });

    const result = await getOpenInvoices(models, { view: "money", olderThanDays: 7 });

    // Buckets cover ALL unpaid invoices regardless of olderThanDays
    expect(result.buckets).toEqual([
      { key: "0_7", count: 1, owed: 5200 },
      { key: "8_14", count: 1, owed: 20000 },
      { key: "15_30", count: 1, owed: 10000 },
      { key: "31_90", count: 0, owed: 0 },
      { key: "90_plus", count: 0, owed: 0 },
    ]);

    // Summary reflects age >= 7
    expect(result.summary.money).toEqual({
      count: 2,
      owed: 30000,
      owedWithItemsOut: 10000,
      accruedCharges: 1500,
    });
    expect(result.summary.both).toEqual({ count: 1, owed: 10000 });
    expect(result.summary.returns).toEqual({ count: 2, unitsOut: 7, overdueCount: 1 });

    // Money sorting: has_items_out first (103), then owed desc (102)
    expect(result.totalCount).toBe(2);
    expect(result.rows.map((r) => r.invoice_id)).toEqual([103, 102]);
    expect(result.rows[0].items_out).toEqual([
      { name: "Scaffolding (3*5)", qty: 3 },
      { name: "Concrete Mixer", qty: 1 },
    ]);
    expect(result.rows[1].customer.name).toBe("Silva Builders");
    expect(result.rows[1].has_items_out).toBe(false);
    expect(result.rows[1].is_unpaid).toBe(true);

    // Second query fetches items only for paged rows
    expect(calls).toHaveLength(2);
    expect(calls[1].replacements.invoiceIds).toEqual([103, 102]);
  });

  it("filters and sorts view=returns with onlyOverdue=1", async () => {
    const sampleRows = [
      {
        invoice_id: 201,
        issued_date: "2026-11-01",
        age_days: 17,
        status: "Active",
        customer_id: 1,
        first_name: "A",
        last_name: "B",
        company_name: null,
        customer_type: "Individual",
        phone_number: null,
        live_total: 1000,
        paid: 1000,
        owed: 0,
        accrued_charges: 0,
        units_out: 2,
        earliest_due_date: "2026-11-20",
        days_overdue: 0,
      },
      {
        invoice_id: 202,
        issued_date: "2026-10-20",
        age_days: 29,
        status: "Active",
        customer_id: 2,
        first_name: "C",
        last_name: "D",
        company_name: null,
        customer_type: "Individual",
        phone_number: "0770000000",
        live_total: 3000,
        paid: 0,
        owed: 3000,
        accrued_charges: 500,
        units_out: 5,
        earliest_due_date: "2026-11-10",
        days_overdue: 8,
      },
    ];

    const { models } = buildFakeModels({
      mainRows: sampleRows,
      itemRows: [{ invoice_id: 202, name: "Drill", qty: 5 }],
    });

    const res = await getOpenInvoices(models, {
      view: "returns",
      olderThanDays: 0,
      onlyOverdue: 1,
    });

    expect(res.totalCount).toBe(1);
    expect(res.rows[0].invoice_id).toBe(202);
    expect(res.rows[0].days_overdue).toBe(8);
    expect(res.summary.returns).toEqual({
      count: 1,
      unitsOut: 5,
      overdueCount: 1,
    });
  });

  it("counts part-returned lines as still out (quantities, not actual_return_date)", async () => {
    const { models, sqls } = buildFakeModels({
      mainRows: [{ invoice_id: 5, issued_date: "2026-11-01", age_days: 17, status: "Active", customer_id: 1,
        first_name: "A", last_name: "B", live_total: 1000, paid: 0, owed: 1000, accrued_charges: 0,
        units_out: 2, earliest_due_date: "2026-11-05", days_overdue: 13 }],
    });
    await getOpenInvoices(models, { view: "returns", olderThanDays: 0 });
    for (const sql of sqls) {
      expect(sql).not.toMatch(/actual_return_date IS NULL/);
      expect(sql).toMatch(/il\.line_status = 'Active' AND GREATEST\(0, il\.borrow_quantity/);
    }
  });

  it("flags invoices whose only lines out are open-ended", async () => {
    const row = (id, open_ended) => ({ invoice_id: id, issued_date: "2026-11-01", age_days: 17, status: "Active",
      customer_id: 1, first_name: "A", last_name: "B", live_total: 0, paid: 0, owed: 0, accrued_charges: 0,
      units_out: 1, earliest_due_date: "2026-11-05", days_overdue: 0, open_ended });
    const { models } = buildFakeModels({ mainRows: [row(1, 1), row(2, 0)] });
    const res = await getOpenInvoices(models, { view: "returns", olderThanDays: 0 });
    const byId = Object.fromEntries(res.rows.map((r) => [r.invoice_id, r.open_ended]));
    expect(byId).toEqual({ 1: true, 2: false });
  });

  it("registers open_money and open_returns in WIDGET_CATALOG and DEFAULT_LAYOUT", () => {
    const moneyDef = WIDGET_CATALOG.find((w) => w.widget_key === "open_money");
    const returnsDef = WIDGET_CATALOG.find((w) => w.widget_key === "open_returns");

    expect(moneyDef).toMatchObject({
      widget_key: "open_money",
      default_w: 6,
      default_h: 4,
      min_w: 3,
      min_h: 3,
      required_permission: "inventory_permission",
    });
    expect(returnsDef).toMatchObject({
      widget_key: "open_returns",
      default_w: 6,
      default_h: 4,
      min_w: 3,
      min_h: 3,
      required_permission: null,
    });

    expect(DEFAULT_LAYOUT.some((l) => l.i === "open_money")).toBe(true);
    expect(DEFAULT_LAYOUT.some((l) => l.i === "open_returns")).toBe(true);
  });
});
