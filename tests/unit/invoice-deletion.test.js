import { describe, it, expect, vi } from "vitest";
import { deleteInvoice, restoreInvoice } from "../../src/services/invoiceDeletionService.js";

vi.mock("../../src/services/notificationService.js", () => ({ createNotification: vi.fn() }));

// Minimal in-memory fake of the tenant models used by the service.
const makeModels = ({ invoice, payments = [], lines = [], equipment = {} }) => {
  const eq = Object.fromEntries(Object.entries(equipment).map(([id, e]) => [id, { equipment_id: Number(id), equipment_name: "Drill", ...e, update: vi.fn(async function (v) { Object.assign(this, v); }), reload: vi.fn() }]));
  const inv = { ...invoice, update: vi.fn(async function (v) { Object.assign(this, v); }) };
  const t = { LOCK: { UPDATE: "UPDATE" } };
  const payModel = { findAll: vi.fn(async () => payments), update: vi.fn(), unscoped: () => payModel };
  return {
    inv, eq, payModel,
    sequelize: { transaction: async (fn) => fn(t) },
    Invoice: { unscoped: () => ({ findByPk: async () => inv }) },
    InvoiceLine: { findAll: async () => lines },
    Equipment: { findByPk: async (id) => eq[id] },
    Customer: { findByPk: async () => ({ deposit_balance: 100, update: vi.fn() }) },
    Payment: payModel,
    InvoiceTrace: { create: vi.fn() },
    User: { findByPk: async () => ({ username: "sam", first_name: "Sam", last_name: "K", Roles: [{ role_name: "Cashier" }] }), findAll: async () => [] },
    Role: {},
  };
};

const cashier = { userId: 7, permissions: new Set(["invoice:delete"]) };
const admin = { userId: 1, permissions: new Set(["*"]) };

describe("invoice deletion rules", () => {
  it("requires a reason, and a note for 'Other'", async () => {
    const m = makeModels({ invoice: { invoice_id: 1, is_deleted: false, advance_paid: 0 } });
    await expect(deleteInvoice(m, 1, cashier, {})).rejects.toMatchObject({ statusCode: 400 });
    await expect(deleteInvoice(m, 1, cashier, { reason: "Other", note: "" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("cashier cannot delete an invoice that has money on it", async () => {
    const m = makeModels({ invoice: { invoice_id: 2, is_deleted: false, advance_paid: 500 }, payments: [{ payment_amount: 500, method: "Cash" }] });
    await expect(deleteInvoice(m, 2, cashier, { reason: "Test entry" })).rejects.toMatchObject({ statusCode: 403 });
    expect(m.inv.update).not.toHaveBeenCalled();
  });

  it("cashier can delete a money-free invoice: stock restored, flagged", async () => {
    const m = makeModels({
      invoice: { invoice_id: 3, is_deleted: false, advance_paid: 0, customer_id: 9 },
      lines: [{ equipment_id: 5, borrow_quantity: 3, good_returned_qty: 1, defective_returned_qty: 0 }],
      equipment: { 5: { rented_qty: 4, available_qty: 6 } },
    });
    const res = await deleteInvoice(m, 3, cashier, { reason: "Created by mistake" });
    expect(res).toMatchObject({ flagged: true, unitsRestored: 2 });
    expect(m.eq[5]).toMatchObject({ rented_qty: 2, available_qty: 8 });
    expect(m.inv).toMatchObject({ is_deleted: true, delete_flagged: true, delete_reason: "Created by mistake" });
  });

  it("admin can delete an invoice with payments: payments voided, not flagged", async () => {
    const m = makeModels({ invoice: { invoice_id: 4, is_deleted: false, advance_paid: 200, customer_id: 9 }, payments: [{ payment_amount: 200, method: "Cash" }] });
    const res = await deleteInvoice(m, 4, admin, { reason: "Duplicate invoice" });
    expect(res).toMatchObject({ flagged: false, voidedPayments: 1, paidTotal: 200 });
    expect(m.payModel.update).toHaveBeenCalledWith({ is_voided: true, voided_at: expect.any(Date) }, expect.anything());
  });

  it("deleting twice is refused", async () => {
    const m = makeModels({ invoice: { invoice_id: 5, is_deleted: true } });
    await expect(deleteInvoice(m, 5, admin, { reason: "Test entry" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("restore refuses when stock has been taken meanwhile", async () => {
    const m = makeModels({
      invoice: { invoice_id: 6, is_deleted: true, customer_id: 9 },
      lines: [{ equipment_id: 5, borrow_quantity: 3, good_returned_qty: 0, defective_returned_qty: 0 }],
      equipment: { 5: { rented_qty: 0, available_qty: 1 } },
    });
    await expect(restoreInvoice(m, 6, admin)).rejects.toMatchObject({ statusCode: 409 });
    expect(m.inv.update).not.toHaveBeenCalled();
  });

  it("restore re-takes stock and un-voids payments", async () => {
    const m = makeModels({
      invoice: { invoice_id: 7, is_deleted: true, customer_id: 9 },
      lines: [{ equipment_id: 5, borrow_quantity: 2, good_returned_qty: 0, defective_returned_qty: 0 }],
      equipment: { 5: { rented_qty: 0, available_qty: 5 } },
    });
    m.payModel.findAll = vi.fn(async () => [{ payment_amount: 100, method: "Cash" }]);
    await restoreInvoice(m, 7, admin);
    expect(m.eq[5]).toMatchObject({ rented_qty: 2, available_qty: 3 });
    expect(m.inv.is_deleted).toBe(false);
    expect(m.payModel.update).toHaveBeenCalledWith({ is_voided: false, voided_at: null }, expect.anything());
  });
});
