// Period pricing: the base price pays for the whole minimum period (scaffolding: Rs. 250 for up to
// 5 days); each day after the period costs the extra daily rate. All per unit.
import { describe, it, expect, vi } from "vitest";
import { processReturn } from "../../src/services/invoiceService.js";
import { lineAccrual } from "../../src/services/accrualService.js";
import { periodCharge, chargeableLateDays } from "../../src/utils/rentalDays.js";

vi.mock("../../src/sockets/emitters.js", () => ({ emitToUser: vi.fn(), emitToTenant: vi.fn() }));

const at = (s) => new Date(`${s}+05:30`);
const withUpdate = (o) => Object.assign(o, { update: vi.fn(async (p) => Object.assign(o, p)) });

const OUT = "2026-11-09";
const ISSUED = at("2026-11-09T11:55:00");
// "Day N" = elapsed time rounded up, so a little after N−1 full days.
const DAY = { 1: at("2026-11-09T18:00:00"), 3: at("2026-11-11T15:00:00"), 5: at("2026-11-13T15:00:00"), 7: at("2026-11-15T15:00:00") };
const DATE = { 1: "2026-11-09", 3: "2026-11-11", 5: "2026-11-13", 7: "2026-11-15" };

// Scaffolding, 2 units, rented with no return date (the POS default).
const scaffold = (over = {}) =>
  withUpdate({
    line_id: 1,
    equipment_id: 1,
    line_status: "Active",
    borrow_quantity: 2,
    good_returned_qty: 0,
    defective_returned_qty: 0,
    borrow_date: OUT,
    expected_return_date: OUT,
    track_overdue: false,
    locked_base_price: 250,
    locked_minimum_days: 5,
    locked_extra_daily_rate: 50,
    line_total_amount: 500,
    accrued_charge: 0,
    accrued_days: 0,
    days_out: null,
    ...over,
  });

const invoiceFor = (line) =>
  withUpdate({ invoice_id: 104, status: "Active", issued_date: ISSUED, sub_total: Number(line.line_total_amount), total_amount: Number(line.line_total_amount), accrued_charges: 0, accrued_rental: 0, id_card_status: 1 });

const buildModels = (inv, line) => ({
  sequelize: { transaction: async (fn) => fn({ LOCK: { UPDATE: "UPDATE" } }) },
  Invoice: { findByPk: async () => inv, findAll: async () => [Object.assign(inv, { InvoiceLines: [line] })] },
  InvoiceLine: {
    findByPk: async () => line,
    count: async ({ where }) => (where.line_status === "Active" && line.line_status === "Active" ? 1 : 0),
  },
  Equipment: { findByPk: async () => withUpdate({ equipment_id: 1, rented_qty: 2, available_qty: 0, defective_qty: 0 }) },
  DefectLog: { create: vi.fn() },
  Payment: { create: vi.fn(), sum: async () => 0 },
  Customer: { update: vi.fn() },
  InvoiceTrace: { create: vi.fn() },
});

const handOver = async (line, inv, day, qty = line.borrow_quantity) =>
  processReturn(
    buildModels(inv, line),
    {
      invoice_id: 104,
      final_payment_amount: 0,
      lines_returned: [{ line_id: 1, good_qty: qty, defective_qty: 0, actual_return_date: DATE[day], actual_return_at: DAY[day].toISOString() }],
    },
    1,
  );

describe("periodCharge (dispatch price and POS preview)", () => {
  it("1-day machine: Rs. 300 a day, unchanged", () => {
    expect(periodCharge({ base: 300, minDays: 1, rate: 300, days: 1, qty: 1 })).toBe(300);
    expect(periodCharge({ base: 300, minDays: 1, rate: 300, days: 3, qty: 2 })).toBe(1800);
  });

  it("5-day scaffold × 2: day 1 and day 5 cost the base, day 7 adds 2 extra days", () => {
    const p = { base: 250, minDays: 5, rate: 50, qty: 2 };
    expect(periodCharge({ ...p, days: 1 })).toBe(500);
    expect(periodCharge({ ...p, days: 3 })).toBe(500);
    expect(periodCharge({ ...p, days: 5 })).toBe(500);
    expect(periodCharge({ ...p, days: 7 })).toBe(700);
  });
});

describe("returning a 5-day scaffold (2 units, no return date)", () => {
  it.each([
    [1, 500],
    [3, 500],
    [5, 500],
    [7, 700],
  ])("back on day %i: line and invoice total Rs. %i", async (day, total) => {
    const line = scaffold();
    const inv = invoiceFor(line);
    await handOver(line, inv, day);
    expect(line.line_total_amount).toBe(total);
    expect(inv.total_amount).toBe(total);
    expect(inv.sub_total).toBe(total); // days out are rental, not a late fee
  });

  it("partial return: 1 unit back on day 7 is billed 2 extra days; the other keeps running", async () => {
    const line = scaffold();
    const inv = invoiceFor(line);
    await handOver(line, inv, 7, 1);
    expect(line.line_total_amount).toBe(600); // 500 + 2 days × 50 × 1 unit
    expect(line.line_status).toBe("Active");
    // the unit still out has the same 2 extra days running
    expect(lineAccrual(line, ISSUED, DAY[7]).accrued_charge).toBe(100);
  });
});

describe("a due date inside the paid period is not a late fee", () => {
  // POS default when tracking is switched on: due back tomorrow.
  const tracked = (over = {}) => scaffold({ track_overdue: true, expected_return_date: "2026-11-10", ...over });

  it("chargeableLateDays: days past the due date that are also past the period", () => {
    expect(chargeableLateDays(tracked(), DATE[3])).toBe(0);
    expect(chargeableLateDays(tracked(), DATE[5])).toBe(0);
    expect(chargeableLateDays(tracked(), DATE[7])).toBe(1); // day 7 by calendar = 6 days out → 1 past the period
    expect(chargeableLateDays(tracked(), "2026-11-16")).toBe(2);
    // 1-day machine: plain days late
    expect(chargeableLateDays({ borrow_date: OUT, expected_return_date: "2026-11-10", locked_minimum_days: 1 }, "2026-11-12")).toBe(2);
    // due date after the period: late days count from the due date
    expect(chargeableLateDays({ borrow_date: OUT, expected_return_date: "2026-11-19", locked_minimum_days: 5 }, "2026-11-21")).toBe(2);
  });

  it("returned on day 3: no late fee (was charged 1 late day × 50 × 2 = Rs. 100 before)", async () => {
    const line = tracked();
    const inv = invoiceFor(line);
    await handOver(line, inv, 3);
    expect(inv.total_amount).toBe(500);
  });

  it("still out on day 3: nothing accrues; 2 days past the period accrues 2 × 50 × 2", () => {
    expect(lineAccrual(tracked(), ISSUED, DAY[3]).accrued_charge).toBe(0);
    expect(lineAccrual(tracked(), ISSUED, at("2026-11-16T12:00:00"))).toMatchObject({ accrued_charge: 200, accrued_days: 2 });
  });
});

describe("today's value while still out (INV-104 style)", () => {
  it("rented today, 2 units: Rs. 500 and nothing extra until the period ends", () => {
    const line = scaffold();
    expect(Number(line.line_total_amount) + lineAccrual(line, ISSUED, DAY[1]).accrued_charge).toBe(500);
    expect(lineAccrual(line, ISSUED, DAY[5]).accrued_charge).toBe(0);
    expect(lineAccrual(line, ISSUED, DAY[7])).toMatchObject({ accrued_charge: 200, accrued_days: 2, days_out: 7 });
  });
});
