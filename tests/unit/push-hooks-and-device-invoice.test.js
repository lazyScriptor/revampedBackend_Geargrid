import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNotifyEvent = vi.fn().mockResolvedValue({ sent: 1, reached: 1 });
const mockRefreshAccruals = vi.fn().mockResolvedValue({});

vi.mock("../../src/services/pushEventService.js", () => ({
  notifyEvent: (...args) => mockNotifyEvent(...args),
}));

vi.mock("../../src/services/accrualService.js", () => ({
  refreshAccruals: (...args) => mockRefreshAccruals(...args),
}));

const invoiceService = await import("../../src/services/invoiceService.js");
const invoiceDeletion = await import("../../src/services/invoiceDeletionService.js");
const customerService = await import("../../src/services/customerService.js");

const flushAsync = () => new Promise((r) => setTimeout(r, 20));

describe("B3 — post-commit notifyEvent hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fires invoice_created after dispatch commit", async () => {
    const t = { LOCK: { UPDATE: "UPDATE" } };
    const models = {
      sequelize: { transaction: vi.fn(async (fn) => fn(t)) },
      Customer: {
        findByPk: vi.fn().mockResolvedValue({
          customer_id: 7,
          first_name: "Nimal",
          last_name: "Perera",
          status: "Active",
        }),
      },
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 3,
          first_name: "Kasun",
          last_name: "Silva",
        }),
      },
      Invoice: {
        create: vi.fn().mockResolvedValue({
          invoice_id: 42,
          total_amount: 6000,
        }),
      },
      InvoiceLine: { bulkCreate: vi.fn().mockResolvedValue([]) },
      Equipment: {
        findByPk: vi.fn().mockResolvedValue({
          equipment_id: 10,
          equipment_name: "Mixer",
          available_qty: 5,
          rented_qty: 0,
          update: vi.fn().mockResolvedValue({}),
        }),
      },
      Payment: { create: vi.fn().mockResolvedValue({}) },
      InvoiceTrace: { create: vi.fn().mockResolvedValue({}) },
    };

    const inv = await invoiceService.createDispatchInvoice(
      models,
      {
        customer_id: 7,
        fees: { transport: 0, discount: 0, advance: 0 },
        items: [
          {
            equipment_id: 10,
            borrow_date: "2026-11-15T08:00:00Z",
            expected_return_date: "2026-11-16T08:00:00Z",
            locked_base_price: 3000,
            locked_minimum_days: 1,
            locked_extra_daily_rate: 1500,
            borrow_quantity: 2,
          },
        ],
      },
      3,
    );

    expect(inv.invoice_id).toBe(42);
    await flushAsync();

    expect(mockNotifyEvent).toHaveBeenCalledWith(
      models,
      "invoice_created",
      expect.objectContaining({
        amount: 6000,
        actorUserId: 3,
        title: "New bill #42 · LKR 6,000",
        body: "Nimal Perera · 1 item(s) · by Kasun Silva",
        data: { type: "invoice_created", invoice_id: "42" },
      }),
    );
  });

  it("fires payment_received and payment_voided on addContinuousPayment", async () => {
    const t = {};
    const models = {
      sequelize: { transaction: vi.fn(async (fn) => fn(t)) },
      Customer: {
        findByPk: vi.fn().mockResolvedValue({
          customer_id: 7,
          first_name: "Nimal",
          last_name: "Perera",
        }),
      },
      User: {
        findByPk: vi.fn().mockResolvedValue({ user_id: 3, first_name: "Kasun", last_name: "" }),
      },
      Invoice: {
        findByPk: vi.fn().mockResolvedValue({ invoice_id: 42, customer_id: 7, status: "Active" }),
      },
      Payment: {
        sum: vi.fn().mockResolvedValue(5000),
        create: vi.fn().mockResolvedValue({ payment_id: 99, payment_amount: 2000 }),
      },
      InvoiceTrace: { create: vi.fn().mockResolvedValue({}) },
    };

    await invoiceService.addContinuousPayment(models, 42, { amount: 2000, method: "Cash" }, 3);
    await flushAsync();

    expect(mockNotifyEvent).toHaveBeenCalledWith(
      models,
      "payment_received",
      expect.objectContaining({
        amount: 2000,
        actorUserId: 3,
        data: { type: "payment_received", invoice_id: "42" },
      }),
    );

    vi.clearAllMocks();
    await invoiceService.addContinuousPayment(
      models,
      42,
      { amount: 1000, method: "Cash", is_refund: true },
      3,
    );
    await flushAsync();

    expect(mockNotifyEvent).toHaveBeenCalledWith(
      models,
      "payment_voided",
      expect.objectContaining({
        amount: 1000,
        actorUserId: 3,
        data: { type: "payment_voided", invoice_id: "42" },
      }),
    );
  });

  it("fires return_processed after processReturn commit", async () => {
    const t = { LOCK: { UPDATE: "UPDATE" } };
    const models = {
      sequelize: { transaction: vi.fn(async (fn) => fn(t)) },
      Customer: {
        findByPk: vi.fn().mockResolvedValue({ customer_id: 7, first_name: "Nimal", last_name: "Perera" }),
        update: vi.fn().mockResolvedValue({}),
      },
      User: { findByPk: vi.fn().mockResolvedValue({ user_id: 3, first_name: "Kasun", last_name: "" }) },
      Invoice: {
        findByPk: vi.fn().mockResolvedValue({
          invoice_id: 42,
          customer_id: 7,
          status: "Active",
          total_amount: 3000,
          sub_total: 3000,
          id_card_status: 1,
          issued_date: "2026-11-14T08:00:00Z",
          update: vi.fn().mockResolvedValue({}),
        }),
      },
      InvoiceLine: {
        findByPk: vi.fn().mockResolvedValue({
          line_id: 1,
          equipment_id: 10,
          borrow_quantity: 1,
          good_returned_qty: 0,
          defective_returned_qty: 0,
          locked_minimum_days: 1,
          locked_extra_daily_rate: 1000,
          borrow_date: "2026-11-14T08:00:00Z",
          expected_return_date: "2026-11-15T08:00:00Z",
          track_overdue: true,
          line_total_amount: 3000,
          update: vi.fn().mockResolvedValue({}),
        }),
        count: vi.fn().mockResolvedValue(0),
      },
      Equipment: {
        findByPk: vi.fn().mockResolvedValue({
          equipment_id: 10,
          rented_qty: 1,
          available_qty: 0,
          defective_qty: 0,
          update: vi.fn().mockResolvedValue({}),
        }),
      },
      Payment: {
        create: vi.fn().mockResolvedValue({}),
        sum: vi.fn().mockResolvedValue(3000),
      },
      InvoiceTrace: { create: vi.fn().mockResolvedValue({}) },
    };

    const ok = await invoiceService.processReturn(
      models,
      {
        invoice_id: 42,
        final_payment_amount: 1500,
        payment_method: "Cash",
        lines_returned: [
          { line_id: 1, good_qty: 1, defective_qty: 0, actual_return_date: "2026-11-15T08:00:00Z" },
        ],
      },
      3,
    );

    expect(ok).toBe(true);
    await flushAsync();

    expect(mockNotifyEvent).toHaveBeenCalledWith(
      models,
      "return_processed",
      expect.objectContaining({
        amount: 1500,
        actorUserId: 3,
        data: { type: "return_processed", invoice_id: "42" },
      }),
    );
  });

  it("fires invoice_deleted, payment_voided (if paid), and invoice_restored", async () => {
    const t = { LOCK: { UPDATE: "UPDATE" } };
    const invoiceRow = {
      invoice_id: 55,
      customer_id: 7,
      total_amount: 8000,
      advance_paid: 0,
      is_deleted: false,
      update: vi.fn(async (patch) => Object.assign(invoiceRow, patch)),
    };
    const models = {
      sequelize: { transaction: vi.fn(async (fn) => fn(t)) },
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 1,
          first_name: "Admin",
          last_name: "",
          Roles: [{ role_name: "Admin" }],
        }),
        findAll: vi.fn().mockResolvedValue([]),
      },
      Role: {},
      Invoice: {
        unscoped: () => ({
          findByPk: vi.fn().mockResolvedValue(invoiceRow),
        }),
      },
      Payment: {
        findAll: vi.fn().mockResolvedValue([{ payment_id: 1, payment_amount: 2500, method: "Cash" }]),
        update: vi.fn().mockResolvedValue([1]),
        unscoped: () => ({
          findAll: vi.fn().mockResolvedValue([{ payment_id: 1, payment_amount: 2500, method: "Cash" }]),
          update: vi.fn().mockResolvedValue([1]),
        }),
      },
      InvoiceLine: { findAll: vi.fn().mockResolvedValue([]) },
      Equipment: { findByPk: vi.fn() },
      Customer: { findByPk: vi.fn(), update: vi.fn() },
      InvoiceTrace: { create: vi.fn().mockResolvedValue({}) },
    };

    await invoiceDeletion.deleteInvoice(
      models,
      55,
      { userId: 1, permissions: new Set(["*"]) },
      { reason: "Created by mistake" },
    );

    expect(mockNotifyEvent).toHaveBeenCalledWith(
      models,
      "invoice_deleted",
      expect.objectContaining({
        amount: 8000,
        data: { type: "invoice_deleted", invoice_id: "55" },
      }),
    );
    expect(mockNotifyEvent).toHaveBeenCalledWith(
      models,
      "payment_voided",
      expect.objectContaining({
        amount: 2500,
        data: { type: "payment_voided", invoice_id: "55" },
      }),
    );

    vi.clearAllMocks();
    await invoiceDeletion.restoreInvoice(models, 55, { userId: 1 });
    expect(mockNotifyEvent).toHaveBeenCalledWith(
      models,
      "invoice_restored",
      expect.objectContaining({
        amount: 8000,
        data: { type: "invoice_restored", invoice_id: "55" },
      }),
    );
  });

  it("fires customer_blacklisted only when status transitions to Blacklisted", async () => {
    const cust = {
      customer_id: 9,
      first_name: "Sunil",
      last_name: "Jaya",
      phone_number: "0771234567",
      status: "Active",
      customer_delete_status: false,
      toJSON: () => ({ customer_id: 9, first_name: "Sunil", last_name: "Jaya", status: "Active" }),
      update: vi.fn(async (patch) => Object.assign(cust, patch)),
    };
    const models = {
      Customer: {
        findByPk: vi.fn().mockResolvedValue(cust),
        findOne: vi.fn().mockResolvedValue(cust),
      },
    };

    await customerService.updateCustomer(models, 9, { status: "Blacklisted" }, 4);
    expect(mockNotifyEvent).toHaveBeenCalledWith(
      models,
      "customer_blacklisted",
      expect.objectContaining({
        actorUserId: 4,
        data: { type: "customer_blacklisted", customer_id: "9" },
      }),
    );

    vi.clearAllMocks();
    // Already blacklisted -> no transition alert
    await customerService.updateCustomer(models, 9, { phone_number: "0779999999" }, 4);
    expect(mockNotifyEvent).not.toHaveBeenCalled();
  });
});

describe("B4 — getDeviceInvoiceSummary", () => {
  it("rejects non-admin device owners with 403", async () => {
    const models = {
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 5,
          is_active: true,
          Roles: [{ role_id: 2, role_name: "Cashier", hierarchy_level: 10, is_active: true }],
        }),
      },
      Role: {},
    };

    await expect(
      invoiceService.getDeviceInvoiceSummary(models, { user_id: 5 }, 42),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("returns 404 when invoice does not exist", async () => {
    const models = {
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 1,
          is_active: true,
          Roles: [{ role_id: 1, role_name: "Admin", hierarchy_level: 100, is_active: true }],
        }),
      },
      Role: {},
      Invoice: { findByPk: vi.fn().mockResolvedValue(null) },
    };

    await expect(
      invoiceService.getDeviceInvoiceSummary(models, { user_id: 1 }, 999),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("computes live total and balance due using invoiceBalance formulas for admin device", async () => {
    const models = {
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 1,
          is_active: true,
          Roles: [{ role_id: 1, role_name: "Admin", hierarchy_level: 100, is_active: true }],
        }),
      },
      Role: {},
      Customer: {},
      InvoiceLine: {},
      Equipment: {},
      Payment: {},
      Invoice: {
        findByPk: vi.fn().mockResolvedValue({
          invoice_id: 42,
          customer_id: 7,
          status: "Active",
          issued_date: "2026-11-14T10:00:00.000Z",
          total_amount: 5000,
          accrued_charges: 500,
          Customer: {
            customer_id: 7,
            customer_type: "Individual",
            first_name: "Nimal",
            last_name: "Perera",
            phone_number: "0771234567",
          },
          InvoiceLines: [
            {
              equipment_id: 10,
              borrow_quantity: 2,
              line_total_amount: 5000,
              accrued_charge: 500,
              Equipment: { equipment_name: "Concrete Mixer" },
            },
          ],
          Payments: [
            { payment_amount: 2000, is_voided: false },
            { payment_amount: 999, is_voided: true },
          ],
          User: { user_id: 3, first_name: "Kasun", last_name: "Silva" },
        }),
      },
    };

    const summary = await invoiceService.getDeviceInvoiceSummary(models, { user_id: 1 }, 42);

    expect(mockRefreshAccruals).toHaveBeenCalledWith(models, { invoiceIds: [42] });
    expect(summary).toMatchObject({
      invoice_id: 42,
      invoice_number: "INV-42",
      status: "Active",
      bill_kind: "rental",
      can_see_money: true,
      issued_at: "2026-11-14T10:00:00.000Z",
      customer: { customer_id: 7, name: "Nimal Perera", phone: "0771234567" },
      items: [{ name: "Concrete Mixer", quantity: 2, line_total: 5500 }],
      total_amount: 5500,
      paid_amount: 2000,
      balance_due: 3500,
      issued_by: "Kasun Silva",
    });
  });

  it("returns full M1 bill details (discount reason, payments with dates, history newest first) and hides money for non-money roles", async () => {
    const models = {
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 8,
          is_active: true,
          Roles: [
            {
              role_id: 4,
              role_name: "Yard",
              hierarchy_level: 20,
              is_active: true,
              Permissions: [{ permission_code: "invoice:view" }],
            },
          ],
        }),
        findAll: vi.fn().mockResolvedValue([
          { user_id: 3, first_name: "Kasun", last_name: "Silva" },
        ]),
      },
      Role: {},
      Permission: {},
      TenantConfig: {
        findOne: vi.fn().mockResolvedValue({
          custom_settings: {
            activity_roles: {
              "4": { types: ["invoice_created", "discount"], see_amounts: false },
            },
          },
        }),
      },
      Customer: {},
      InvoiceLine: {},
      Equipment: {},
      Payment: {},
      InvoiceTrace: {
        findAll: vi.fn().mockResolvedValue([
          {
            trace_id: 1,
            invoice_id: 99,
            actor_user_id: 3,
            event_category: "INVOICE",
            event_action: "CREATED",
            occurred_at: "2026-11-20T08:00:00.000Z",
          },
        ]),
      },
      ActivityEvent: {
        findAll: vi.fn().mockResolvedValue([
          {
            event_id: 10,
            invoice_id: 99,
            type: "discount",
            risk: "high",
            actor_user_id: 3,
            occurred_at: "2026-11-20T09:00:00.000Z",
            data: { sentence: { en: "Discount Rs 500 added by Kasun", si: "Kasun විසින් රු. 500 වට්ටමක්" } },
          },
        ]),
      },
      Invoice: {
        unscoped: () => ({
          findByPk: vi.fn().mockResolvedValue({
            invoice_id: 99,
            customer_id: 7,
            status: "Active",
            is_deleted: false,
            issued_date: "2026-11-18T10:00:00.000Z",
            createdAt: "2026-11-20T10:00:00.000Z",
            total_amount: 4500,
            discount_amount: 500,
            discount_reason_key: "regular_customer",
            discount_reason_note: "VIP",
            Customer: { customer_id: 7, first_name: "Nimal", last_name: "Perera", phone_number: "0771234567" },
            InvoiceLines: [
              { line_id: 1, equipment_id: 10, borrow_quantity: 1, line_total_amount: 5000, accrued_charge: 0, settlement_id: 55, Equipment: { equipment_name: "Drill" } },
            ],
            Payments: [
              { payment_id: 2, payment_amount: 2000, method: "Cash", payment_date: "2026-11-19T00:00:00.000Z", entered_at: "2026-11-20T09:30:00.000Z", received_by_user_id: 3, is_voided: false, settlement_id: 55 },
            ],
          }),
        }),
      },
    };

    const summary = await invoiceService.getDeviceInvoiceSummary(models, { user_id: 8 }, 99);
    expect(summary.can_see_money).toBe(false);
    expect(summary.total_amount).toBeNull();
    expect(summary.balance_due).toBeNull();
    expect(summary.discount_reason_key).toBe("regular_customer");
    expect(summary.discount_reason_note).toBe("VIP");
    expect(summary.settlement_id).toBe(55);
    expect(summary.backdated_days).toBe(2);
    expect(summary.payments[0].amount).toBeNull();
    expect(summary.payments[0].staff_name).toBe("Kasun Silva");
    expect(summary.history).toHaveLength(2);
    expect(summary.history[0].source).toBe("activity");
    expect(summary.history[0].sentence_en).not.toContain("500");
  });
});
