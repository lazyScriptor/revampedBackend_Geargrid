import { describe, expect, it, vi } from "vitest";
import {
  CustomerBriefSchema,
  GetDeviceBriefsContract,
  LookupDeviceBriefContract,
} from "@geargrid/contracts";
import {
  buildBriefs,
  lookupDeviceBrief,
  syncDeviceBriefs,
  touchCustomerBrief,
} from "../../src/services/customerBriefService.js";
import { recomputeCustomerRating } from "../../src/services/invoiceReviewService.js";
import { refreshAccruals } from "../../src/services/accrualService.js";
import { addContinuousPayment } from "../../src/services/invoiceService.js";
import { updateCustomer } from "../../src/services/customerService.js";
import { liveTotalOf, owedAmount } from "../../src/utils/invoiceBalance.js";

describe("customerBriefService (C1)", () => {
  it("computes balance_due via invoiceBalance, caps active_items at 5, omits zero summary parts, and runs batch queries", async () => {
    const now = new Date("2026-11-15T10:00:00+05:30");

    const customerFindAll = vi.fn().mockResolvedValue([
      {
        customer_id: 11,
        first_name: "Kamal",
        last_name: "Perera",
        company_name: "Kamal Builders",
        phone_number: "0771234567",
        rating: 4,
        status: "Active",
        deposit_balance: 5000,
        is_id_retained_currently: false,
        customer_delete_status: false,
        brief_changed_at: new Date("2026-11-15T09:00:00Z"),
        ParentCompany: { company_name: "Apex Holdings" },
      },
      {
        customer_id: 12,
        first_name: "Nimal",
        last_name: "Silva",
        company_name: null,
        phone_number: "0719876543",
        rating: 5,
        status: "Active",
        deposit_balance: 0,
        is_id_retained_currently: false,
        customer_delete_status: false,
        brief_changed_at: null,
        updatedAt: new Date("2026-11-10T08:00:00Z"),
        ParentCompany: null,
      },
    ]);

    const phoneFindAll = vi.fn().mockResolvedValue([
      { phone_id: 1, customer_id: 11, phone_e164: "94771234567", is_primary: true },
      { phone_id: 2, customer_id: 11, phone_e164: "94112345678", is_primary: false },
      { phone_id: 3, customer_id: 12, phone_e164: "94719876543", is_primary: true },
    ]);

    const openInvPayments = [
      {
        payment_id: 101,
        invoice_id: 501,
        payment_amount: 1000,
        payment_date: new Date("2026-11-10T09:00:00Z"),
        method: "Cash",
        is_voided: false,
      },
      {
        payment_id: 102,
        invoice_id: 501,
        payment_amount: 9999,
        payment_date: new Date("2026-11-11T09:00:00Z"),
        method: "Cash",
        is_voided: true, // must be ignored!
      },
    ];
    const openInv = {
      invoice_id: 501,
      customer_id: 11,
      status: "Active",
      is_deleted: false,
      id_card_status: 1,
      issued_date: "2024-06-05",
      total_amount: 10000,
      accrued_charges: 3000,
      Payments: openInvPayments,
      InvoiceLines: [
        {
          equipment_id: 1,
          line_status: "Active",
          borrow_quantity: 2,
          good_returned_qty: 0,
          defective_returned_qty: 0,
          borrow_date: "2026-11-01",
          expected_return_date: "2026-11-12", // 3 days overdue on 2026-11-15
          track_overdue: true,
          Equipment: { equipment_name: "Breaker Hammer" },
        },
        {
          equipment_id: 2,
          line_status: "Active",
          borrow_quantity: 4,
          good_returned_qty: 1,
          defective_returned_qty: 0,
          borrow_date: "2026-11-10",
          expected_return_date: "2026-11-10", // open-ended when track_overdue: false
          track_overdue: false,
          Equipment: { equipment_name: "Acro Jack" },
        },
        {
          equipment_id: 3,
          line_status: "Active",
          borrow_quantity: 1,
          good_returned_qty: 0,
          defective_returned_qty: 0,
          borrow_date: "2026-11-12",
          expected_return_date: "2026-11-14", // 1 day overdue
          track_overdue: true,
          Equipment: { equipment_name: "Grinder" },
        },
        {
          equipment_id: 4,
          line_status: "Active",
          borrow_quantity: 1,
          good_returned_qty: 0,
          defective_returned_qty: 0,
          borrow_date: "2026-11-13",
          expected_return_date: "2026-11-18",
          track_overdue: true,
          Equipment: { equipment_name: "Vibrator" },
        },
        {
          equipment_id: 5,
          line_status: "Active",
          borrow_quantity: 1,
          good_returned_qty: 0,
          defective_returned_qty: 0,
          borrow_date: "2026-11-13",
          expected_return_date: "2026-11-19",
          track_overdue: true,
          Equipment: { equipment_name: "Cut-off Saw" },
        },
        {
          equipment_id: 6,
          line_status: "Active",
          borrow_quantity: 1,
          good_returned_qty: 0,
          defective_returned_qty: 0,
          borrow_date: "2026-11-14",
          expected_return_date: "2026-11-14", // second open-ended item (capped off after Acro Jack)
          track_overdue: false,
          Equipment: { equipment_name: "Scaffold" },
        },
        {
          equipment_id: 7,
          line_status: "Completed",
          borrow_quantity: 1,
          good_returned_qty: 1,
          defective_returned_qty: 0,
          borrow_date: "2026-11-01",
          expected_return_date: "2026-11-02",
          track_overdue: true,
          Equipment: { equipment_name: "Returned Item" },
        },
      ],
    };

    const deletedInv = {
      invoice_id: 502,
      customer_id: 11,
      status: "Active",
      is_deleted: true,
      issued_date: "2026-11-12",
      total_amount: 50000,
      accrued_charges: 0,
      Payments: [],
      InvoiceLines: [],
    };

    const completedInv = {
      invoice_id: 503,
      customer_id: 11,
      status: "Completed",
      is_deleted: false,
      issued_date: "2026-10-01",
      total_amount: 4000,
      accrued_charges: 0,
      Payments: [
        {
          payment_id: 105,
          invoice_id: 503,
          payment_amount: 4000,
          payment_date: new Date("2026-10-05T11:00:00Z"),
          method: "Bank Transfer",
          is_voided: false,
        },
      ],
      InvoiceLines: [],
    };

    const invoiceFindAll = vi.fn().mockResolvedValue([openInv, deletedInv, completedInv]);
    const reviewFindAll = vi.fn().mockResolvedValue([
      {
        review_id: 9,
        customer_id: 11,
        comment: "Good payer, bring ID",
        createdAt: new Date("2026-11-12T10:00:00Z"),
      },
      {
        review_id: 8,
        customer_id: 11,
        comment: "Older note",
        createdAt: new Date("2026-10-01T10:00:00Z"),
      },
    ]);

    const models = {
      Customer: { findAll: customerFindAll },
      CustomerPhone: { findAll: phoneFindAll },
      Invoice: { findAll: invoiceFindAll },
      InvoiceLine: {},
      Equipment: {},
      Payment: {},
      InvoiceReview: { findAll: reviewFindAll },
    };

    const briefs = await buildBriefs(models, [11, 12], { now });

    // Batch queries: strictly 1 call per table for the whole batch!
    expect(customerFindAll).toHaveBeenCalledTimes(1);
    expect(phoneFindAll).toHaveBeenCalledTimes(1);
    expect(invoiceFindAll).toHaveBeenCalledTimes(1);
    expect(reviewFindAll).toHaveBeenCalledTimes(1);

    expect(briefs).toHaveLength(2);
    const [b11, b12] = briefs;

    const expectedOwed = owedAmount(
      liveTotalOf(openInv),
      openInvPayments.filter((p) => !p.is_voided),
    );
    expect(b11.balance_due).toBe(expectedOwed); // 10000 + 3000 - 1000 = 12000
    expect(b11.id_retained).toBe(true);
    expect(b11.parent_company).toBe("Apex Holdings");
    expect(b11.phones).toEqual(["94771234567", "94112345678"]);
    expect(b11.active_items).toHaveLength(5);
    expect(b11.active_items[0]).toEqual({
      name: "Breaker Hammer",
      qty: 2,
      due: "2026-11-12",
      overdue_days: 3,
    });
    expect(b11.active_items[1]).toEqual({
      name: "Grinder",
      qty: 1,
      due: "2026-11-14",
      overdue_days: 1,
    });
    expect(b11.active_items.find((i) => i.name === "Acro Jack")).toEqual({
      name: "Acro Jack",
      qty: 3,
      due: null,
      overdue_days: 0,
    });
    expect(b11.invoice_count).toBe(2);
    expect(b11.first_rental).toBe("2024-06-05");
    expect(b11.last_rental).toBe("2026-10-01");
    expect(b11.last_payment).toEqual({
      amount: 1000,
      date: "2026-11-10",
      method: "Cash",
    });
    expect(b11.last_review_comment).toBe("Good payer, bring ID");
    expect(b11.summary_line).toBe(
      "★4 · Owes LKR 12,000 · 2 items overdue 3 days · 2 rentals since 2024",
    );

    // Zero parts omitted on Nimal (no debt, no active items, no invoices)
    expect(b12.balance_due).toBe(0);
    expect(b12.active_items).toEqual([]);
    expect(b12.invoice_count).toBe(0);
    expect(b12.summary_line).toBe("★5");

    expect(() => CustomerBriefSchema.parse(b11)).not.toThrow();
    expect(() => CustomerBriefSchema.parse(b12)).not.toThrow();
  });

  it("paginates GET /device/briefs, returns deleted_customer_ids on delta sync, and updates briefs_synced_at on final page", async () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const device = {
      operator_device_id: 7,
      update: vi.fn().mockResolvedValue(true),
    };

    // Page 1 of 2 (limit=1 returns 2 rows to signal hasMore)
    const customerFindAllPage1 = vi.fn().mockResolvedValueOnce([
      { customer_id: 10 },
      { customer_id: 20 },
    ]).mockResolvedValueOnce([
      {
        customer_id: 10,
        first_name: "Sunil",
        last_name: "Jaya",
        company_name: null,
        phone_number: "0771111111",
        rating: 5,
        status: "Active",
        deposit_balance: 0,
        is_id_retained_currently: false,
        customer_delete_status: false,
        brief_changed_at: now,
      },
    ]);

    const modelsPage1 = {
      Customer: { findAll: customerFindAllPage1 },
      CustomerPhone: { findAll: vi.fn().mockResolvedValue([]) },
      Invoice: { findAll: vi.fn().mockResolvedValue([]) },
      InvoiceReview: { findAll: vi.fn().mockResolvedValue([]) },
    };

    const page1 = await syncDeviceBriefs(modelsPage1, device, { limit: 1 }, { now });
    expect(page1.next_cursor).toBe(10);
    expect(page1.briefs).toHaveLength(1);
    expect(device.update).not.toHaveBeenCalled();

    // Final delta page with deleted customer IDs
    const customerFindAllDelta = vi
      .fn()
      .mockResolvedValueOnce([{ customer_id: 20 }])
      .mockResolvedValueOnce([
        {
          customer_id: 20,
          first_name: "Rohan",
          last_name: "D",
          company_name: null,
          phone_number: "0772222222",
          rating: 5,
          status: "Active",
          deposit_balance: 0,
          is_id_retained_currently: false,
          customer_delete_status: false,
          brief_changed_at: now,
        },
      ])
      .mockResolvedValueOnce([{ customer_id: 99 }]);

    const modelsDelta = {
      Customer: { findAll: customerFindAllDelta },
      CustomerPhone: { findAll: vi.fn().mockResolvedValue([]) },
      Invoice: { findAll: vi.fn().mockResolvedValue([]) },
      InvoiceReview: { findAll: vi.fn().mockResolvedValue([]) },
    };

    const page2 = await syncDeviceBriefs(
      modelsDelta,
      device,
      { since: "2026-11-14T00:00:00Z", limit: 500 },
      { now },
    );
    expect(page2.next_cursor).toBeNull();
    expect(page2.deleted_customer_ids).toEqual([99]);
    expect(device.update).toHaveBeenCalledWith({ briefs_synced_at: now });
    expect(() => GetDeviceBriefsContract.response.shape.data.parse(page2)).not.toThrow();
  });

  it("looks up customer first, falls back to phone contact, then none", async () => {
    const modelsCustomer = {
      CustomerPhone: {
        findAll: vi
          .fn()
          .mockResolvedValueOnce([{ customer_id: 5 }])
          .mockResolvedValueOnce([{ phone_id: 1, customer_id: 5, phone_e164: "94771234567", is_primary: true }]),
      },
      Customer: {
        findAll: vi.fn().mockResolvedValue([
          {
            customer_id: 5,
            first_name: "Ajith",
            last_name: "Kumara",
            company_name: null,
            phone_number: "0771234567",
            rating: 5,
            status: "Active",
            deposit_balance: 0,
            is_id_retained_currently: false,
            customer_delete_status: false,
            brief_changed_at: new Date("2026-11-15T00:00:00Z"),
          },
        ]),
      },
      Invoice: { findAll: vi.fn().mockResolvedValue([]) },
      InvoiceReview: { findAll: vi.fn().mockResolvedValue([]) },
    };

    const customerRes = await lookupDeviceBrief(modelsCustomer, {}, { phone: "077 123 4567" });
    expect(customerRes.match).toBe("customer");
    expect(customerRes.brief?.customer_id).toBe(5);
    expect(() => LookupDeviceBriefContract.response.shape.data.parse(customerRes)).not.toThrow();

    const modelsContact = {
      CustomerPhone: { findAll: vi.fn().mockResolvedValue([]) },
      PhoneContact: {
        findOne: vi.fn().mockResolvedValue({
          contact_id: 42,
          display_name: "Saman Mason",
          phone_e164: "94775554444",
          OperatorDevice: { device_label: "Shop Counter" },
        }),
      },
      OperatorDevice: {},
    };

    const contactRes = await lookupDeviceBrief(modelsContact, {}, { phone: "+94 77 555 4444" });
    expect(contactRes).toEqual({
      match: "contact",
      brief: null,
      contact: {
        contact_id: 42,
        display_name: "Saman Mason",
        phone_e164: "94775554444",
        device_label: "Shop Counter",
      },
    });
    expect(() => LookupDeviceBriefContract.response.shape.data.parse(contactRes)).not.toThrow();

    const noneRes = await lookupDeviceBrief(
      {
        CustomerPhone: { findAll: vi.fn().mockResolvedValue([]) },
        PhoneContact: { findOne: vi.fn().mockResolvedValue(null) },
      },
      {},
      { phone: "0770000000" },
    );
    expect(noneRes).toEqual({ match: "none", brief: null, contact: null });
    expect(() => LookupDeviceBriefContract.response.shape.data.parse(noneRes)).not.toThrow();
  });

  it("touches brief_changed_at via touchCustomerBrief, recomputeCustomerRating, and refreshAccruals", async () => {
    const updateMock = vi.fn().mockResolvedValue([1]);
    const now = new Date("2026-11-15T10:30:00Z");

    await touchCustomerBrief({ Customer: { update: updateMock } }, [7, 7, 8], { now });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).toEqual({ brief_changed_at: now });

    // Review rating recompute also sets brief_changed_at
    const reviewCustomerUpdate = vi.fn().mockResolvedValue([1]);
    await recomputeCustomerRating(
      {
        sequelize: { fn: vi.fn(), col: vi.fn(), Sequelize: { Op: { not: Symbol("not") } } },
        InvoiceReview: { findOne: vi.fn().mockResolvedValue({ avg_rating: "4.0" }) },
        Customer: { update: reviewCustomerUpdate },
      },
      15,
    );
    expect(reviewCustomerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ rating: 4, brief_changed_at: expect.any(Date) }),
      expect.objectContaining({ where: { customer_id: 15 } }),
    );

    // Accrual refresh touches brief_changed_at when invoice accrual changes
    const accrualCustomerUpdate = vi.fn().mockResolvedValue([1]);
    const invoiceUpdate = vi.fn().mockResolvedValue(true);
    const lineUpdate = vi.fn().mockResolvedValue(true);
    await refreshAccruals(
      {
        Invoice: {
          findAll: vi.fn().mockResolvedValue([
            {
              invoice_id: 900,
              customer_id: 33,
              issued_date: "2026-11-01",
              status: "Active",
              accrued_charges: 0,
              accrued_rental: 0,
              update: invoiceUpdate,
              InvoiceLines: [
                {
                  line_status: "Active",
                  borrow_quantity: 1,
                  good_returned_qty: 0,
                  defective_returned_qty: 0,
                  borrow_date: "2026-11-01",
                  expected_return_date: "2026-11-01",
                  track_overdue: false,
                  locked_minimum_days: 1,
                  locked_extra_daily_rate: 500,
                  accrued_charge: 0,
                  accrued_days: 0,
                  days_out: 1,
                  update: lineUpdate,
                },
              ],
            },
          ]),
        },
        InvoiceLine: {},
        Customer: { update: accrualCustomerUpdate },
      },
      { now: new Date("2026-11-05T10:00:00+05:30") },
    );
    expect(invoiceUpdate).toHaveBeenCalledTimes(1);
    expect(accrualCustomerUpdate).toHaveBeenCalledTimes(1);
  });

  it("touches brief_changed_at on addContinuousPayment and updateCustomer", async () => {
    const t = { LOCK: { UPDATE: "UPDATE" } };
    const payCustUpdate = vi.fn().mockResolvedValue([1]);
    await addContinuousPayment(
      {
        sequelize: { transaction: vi.fn(async (fn) => fn(t)) },
        Invoice: {
          findByPk: vi.fn().mockResolvedValue({ invoice_id: 55, customer_id: 88, status: "Active" }),
        },
        Payment: { create: vi.fn().mockResolvedValue({ payment_id: 1 }) },
        InvoiceTrace: { create: vi.fn().mockResolvedValue({}) },
        Customer: {
          findByPk: vi.fn().mockResolvedValue({ customer_id: 88, first_name: "A", last_name: "B" }),
          update: payCustUpdate,
        },
      },
      55,
      { amount: 500, method: "Cash" },
      1,
    );
    expect(payCustUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ brief_changed_at: expect.any(Date) }),
      expect.objectContaining({ where: { customer_id: 88 } }),
    );

    const custRowUpdate = vi.fn().mockResolvedValue(true);
    await updateCustomer(
      {
        Customer: {
          findByPk: vi.fn().mockResolvedValue({
            customer_id: 88,
            nic_number: "900000000V",
            status: "Active",
            customer_delete_status: false,
            update: custRowUpdate,
          }),
          findOne: vi.fn().mockResolvedValue({
            customer_id: 88,
            first_name: "Updated",
            last_name: "Name",
          }),
        },
      },
      88,
      { first_name: "Updated" },
      1,
    );
    expect(custRowUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ first_name: "Updated", brief_changed_at: expect.any(Date) }),
      expect.any(Object),
    );
  });
});
