import { describe, it, expect, vi } from "vitest";
import { processReturn } from "../../src/services/invoiceService.js";

vi.mock("../../src/sockets/emitters.js", () => ({ emitToUser: vi.fn(), emitToTenant: vi.fn() }));

const at = (s) => new Date(`${s}+05:30`);
const withUpdate = (o) => Object.assign(o, { update: vi.fn(async (p) => Object.assign(o, p)) });

const buildModels = (inv, line) => ({
  sequelize: { transaction: async (fn) => fn({ LOCK: { UPDATE: "UPDATE" } }) },
  Invoice: {
    findByPk: async () => inv,
    findAll: async () => [Object.assign(inv, { InvoiceLines: [line] })],
  },
  InvoiceLine: {
    findByPk: async () => line,
    count: async ({ where }) => (where.line_status === "Active" && line.line_status === "Active" ? 1 : 0),
  },
  Equipment: { findByPk: async () => withUpdate({ equipment_id: 1, rented_qty: 1, available_qty: 0, defective_qty: 0 }) },
  DefectLog: { create: vi.fn() },
  Payment: { create: vi.fn(), sum: async () => 0 },
  Customer: { update: vi.fn() },
  InvoiceTrace: { create: vi.fn() },
});

const baseLine = (over = {}) =>
  withUpdate({
    line_id: 1,
    equipment_id: 1,
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
    accrued_charge: 0,
    accrued_days: 0,
    days_out: null,
    ...over,
  });
const baseInvoice = (over = {}) =>
  withUpdate({ invoice_id: 55, status: "Active", issued_date: at("2026-10-30T09:46:00"), sub_total: 300, total_amount: 300, accrued_charges: 0, accrued_rental: 0, id_card_status: 1, ...over });

describe("the rental days are the main cost", () => {
  it("INV-55: Step Ladder with no return date, back after 29 hours: line, subtotal and total are Rs 600", async () => {
    const line = baseLine();
    const inv = baseInvoice();
    await processReturn(
      buildModels(inv, line),
      {
        invoice_id: 55,
        final_payment_amount: 0,
        lines_returned: [{ line_id: 1, good_qty: 1, defective_qty: 0, actual_return_date: "2026-10-31", actual_return_at: at("2026-10-31T15:08:00").toISOString() }],
      },
      1,
    );
    expect(line.line_total_amount).toBe(600);
    expect(inv.sub_total).toBe(600);
    expect(inv.total_amount).toBe(600);
    expect(inv.accrued_charges).toBe(0);
  });

  it("a machine with a due date returned 2 days late: the total grows, the subtotal does not (late fee)", async () => {
    const line = baseLine({ track_overdue: true, expected_return_date: "2026-10-31", line_total_amount: 300 });
    const inv = baseInvoice();
    await processReturn(
      buildModels(inv, line),
      { invoice_id: 55, final_payment_amount: 0, lines_returned: [{ line_id: 1, good_qty: 1, defective_qty: 0, actual_return_date: "2026-11-02" }] },
      1,
    );
    expect(inv.total_amount).toBe(900);
    expect(inv.sub_total).toBe(300);
  });
});
