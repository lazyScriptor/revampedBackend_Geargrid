import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sequelize } from "sequelize";
import { lineAccrual, refreshAccruals, ensureFreshAccruals, resetAccrualThrottle } from "../../src/services/accrualService.js";
import { liveTotalOf, owedExpr, liveTotalExpr } from "../../src/utils/invoiceBalance.js";
import InvoiceFactory from "../../src/models/Invoice.js";

const at = (s) => new Date(`${s}+05:30`);

// INV-55 from the screenshot: Step Ladder, Rs 300/day, rented yesterday 9:46 AM with no return date.
const ladder = {
  line_id: 1,
  line_status: "Active",
  borrow_quantity: 1,
  good_returned_qty: 0,
  defective_returned_qty: 0,
  borrow_date: "2026-10-30",
  expected_return_date: "2026-10-30",
  track_overdue: false,
  locked_minimum_days: 1,
  locked_base_price: 300,
  locked_extra_daily_rate: 300,
  line_total_amount: 300,
};
const ISSUED = at("2026-10-30T09:46:00");

describe("running charge on a line", () => {
  it("INV-55: out 29 hours = 2 days, so Rs 300 more than the 1-day price", () => {
    expect(lineAccrual(ladder, ISSUED, at("2026-10-31T15:00:00"))).toEqual({ accrued_charge: 300, accrued_days: 1, days_out: 2, rental: true });
  });

  it("nothing extra inside the first 24 hours", () => {
    expect(lineAccrual(ladder, ISSUED, at("2026-10-31T09:46:00"))).toEqual({ accrued_charge: 0, accrued_days: 0, days_out: 1, rental: true });
  });

  it("only units still out accrue", () => {
    const partly = { ...ladder, borrow_quantity: 3, good_returned_qty: 1 };
    expect(lineAccrual(partly, ISSUED, at("2026-11-01T10:00:00")).accrued_charge).toBe(2 * 300 * 2); // 3 days → 2 extra × 2 units
  });

  it("tracked line: late days after the due date", () => {
    const tracked = { ...ladder, track_overdue: true, expected_return_date: "2026-10-31" };
    expect(lineAccrual(tracked, ISSUED, at("2026-11-02T12:00:00"))).toEqual({ accrued_charge: 600, accrued_days: 2, days_out: 3, rental: false });
  });

  it("returned lines and waived lines carry nothing", () => {
    expect(lineAccrual({ ...ladder, line_status: "Returned" }, ISSUED, at("2026-11-05T10:00:00")).accrued_charge).toBe(0);
    expect(lineAccrual({ ...ladder, expected_return_date: "2026-10-31" }, ISSUED, at("2026-11-05T10:00:00")).accrued_charge).toBe(0);
  });
});

describe("refresh", () => {
  const build = () => {
    const line = { ...ladder, accrued_charge: 0, accrued_days: 0, days_out: null, update: vi.fn(async (p) => Object.assign(line, p)) };
    const inv = { invoice_id: 55, issued_date: ISSUED, status: "Active", accrued_charges: 0, accrued_rental: 0, InvoiceLines: [line], update: vi.fn(async (p) => Object.assign(inv, p)) };
    const models = { sequelize: { config: { database: "geargrid_test" } }, Invoice: { findAll: vi.fn(async () => [inv]) }, InvoiceLine: {} };
    return { models, inv, line };
  };

  beforeEach(() => resetAccrualThrottle());

  it("saves the charge on the line and the invoice, and is a no-op when nothing changed", async () => {
    const { models, inv, line } = build();
    const now = at("2026-10-31T15:00:00");
    expect(await refreshAccruals(models, { now })).toEqual({ invoices: 1, changed: 1 });
    expect(line.accrued_charge).toBe(300);
    expect(line.days_out).toBe(2);
    expect(inv.accrued_charges).toBe(300);
    expect(inv.accrued_rental).toBe(300); // days out are rental, not a late fee
    expect(await refreshAccruals(models, { now })).toEqual({ invoices: 1, changed: 0 });
    expect(line.update).toHaveBeenCalledTimes(1);
  });

  it("lists refresh at most once a minute", async () => {
    const { models } = build();
    await ensureFreshAccruals(models, { now: at("2026-10-31T15:00:00") });
    expect(await ensureFreshAccruals(models, { now: at("2026-10-31T15:00:30") })).toBeNull();
    expect(models.Invoice.findAll).toHaveBeenCalledTimes(1);
  });
});

describe("one live total everywhere", () => {
  it("API JSON: subtotal and total are the rental so far; billed figures kept separately", () => {
    const seq = new Sequelize("mysql://u:p@127.0.0.1:1/none", { logging: false });
    const Invoice = InvoiceFactory(seq);
    const json = Invoice.build({ invoice_id: 55, sub_total: "300.00", total_amount: "300.00", accrued_charges: "300.00", accrued_rental: "300.00", customer_id: 1, issued_by_user_id: 1 }).toJSON();
    expect(json.sub_total).toBe(600);
    expect(json.total_amount).toBe(600);
    expect(json.billed_sub_total).toBe(300);
    expect(json.billed_total_amount).toBe(300);
  });

  it("a late fee raises the total but not the subtotal", () => {
    const seq = new Sequelize("mysql://u:p@127.0.0.1:1/none", { logging: false });
    const Invoice = InvoiceFactory(seq);
    const json = Invoice.build({ invoice_id: 7, sub_total: "1000.00", total_amount: "1000.00", accrued_charges: "500.00", accrued_rental: "0.00", customer_id: 1, issued_by_user_id: 1 }).toJSON();
    expect(json.sub_total).toBe(1000);
    expect(json.total_amount).toBe(1500);
  });

  it("liveTotalOf works for rows, model data and API JSON without counting twice", () => {
    expect(liveTotalOf({ total_amount: "300.00", accrued_charges: "300.00" })).toBe(600);
    expect(liveTotalOf({ total_amount: 600, billed_total_amount: 300, accrued_charges: 300 })).toBe(600);
    expect(liveTotalOf({ total_amount: 600 })).toBe(600); // SQL row already live
  });

  it("SQL balance uses the live total", () => {
    expect(liveTotalExpr("i")).toBe("(i.total_amount + COALESCE(i.accrued_charges, 0))");
    expect(owedExpr()).toBe("((i.total_amount + COALESCE(i.accrued_charges, 0)) - COALESCE(p.total_paid, 0))");
  });
});

describe("old invoices: rental days billed at a handover move into the subtotal", async () => {
  const { rentalPart } = await import("../../migrations/tenant/20261101140000-rental-days-in-subtotal.js");
  it("a no-return-date line is all rental", () => {
    expect(rentalPart({ ...ladder, line_status: "Returned", line_total_amount: "600.00" })).toBe(600);
  });
  it("a line with a due date: rental up to the agreed days, the rest stays a late fee", () => {
    const tracked = { ...ladder, track_overdue: 1, expected_return_date: "2026-11-01", line_total_amount: "1200.00" }; // 2 agreed days = 600
    expect(rentalPart(tracked)).toBe(600);
  });
});
