import { beforeEach, describe, expect, it, vi } from "vitest";
import { Op, Sequelize } from "sequelize";

const mockSendToUsers = vi.fn().mockResolvedValue({ sent: 1, reached: 1 });
const mockCreateNotification = vi.fn().mockResolvedValue({});
const mockGetTenantPlan = vi.fn().mockResolvedValue(null);

vi.mock("../../src/services/devicePushService.js", () => ({
  sendToUsers: (...args) => mockSendToUsers(...args),
}));

vi.mock("../../src/services/notificationService.js", () => ({
  createNotification: (...args) => mockCreateNotification(...args),
}));

vi.mock("../../src/services/planService.js", () => ({
  getTenantPlan: (...args) => mockGetTenantPlan(...args),
}));

const { initTenantModels } = await import("../../src/models/index.js");
const { ACTIVITY_EVENT_TYPES } = await import("../../src/models/ActivityEvent.js");
const {
  recordActivity,
  listActivity,
  getActivitySummary,
  checkEvent,
  uncheckEvent,
  addComment,
  listComments,
  markRead,
  exportActivityExcel,
} = await import("../../src/services/activityService.js");
const {
  getActivitySettings,
  updateActivitySettings,
  validateReason,
} = await import("../../src/services/activitySettingsService.js");
const {
  createDispatchInvoice,
  updateInvoiceFees,
  addContinuousPayment,
  processReturn,
  toggleVaultStatus,
  reopenInvoice,
  previewReturn,
} = await import("../../src/services/invoiceService.js");
const { deleteInvoice, restoreInvoice } = await import("../../src/services/invoiceDeletionService.js");
const reviewService = await import("../../src/services/invoiceReviewService.js");
const { notifyEvent, sendDailySummaryPush } = await import("../../src/services/pushEventService.js");

const dummySeq = new Sequelize("mysql://user:pass@localhost:3306/dummy_tenant", { logging: false });
const realModels = initTenantModels(dummySeq);

const assertSavable = async (Model, data) => {
  const inst = Model.build(data);
  await inst.validate();
  return inst;
};

const makeFakeStore = ({
  customSettings = {},
  timezone = "Asia/Colombo",
  printLogsCount = 0,
  invoiceOverrides = {},
  lines = [],
  payments = [],
} = {}) => {
  const store = {
    events: [],
    comments: [],
    reads: [],
    invoices: [
      {
        invoice_id: 101,
        customer_id: 10,
        issued_by_user_id: 2,
        total_amount: 10000,
        sub_total: 10000,
        transport_fee: 0,
        discount_amount: 0,
        advance_paid: 0,
        accrued_charges: 0,
        accrued_rental: 0,
        id_card_status: 1,
        status: "Active",
        is_deleted: false,
        issued_date: new Date("2026-11-20T05:00:00Z"),
        ...invoiceOverrides,
      },
    ],
    lines: lines.length
      ? lines
      : [
          {
            line_id: 1,
            invoice_id: 101,
            equipment_id: 5,
            borrow_date: "2026-11-18",
            expected_return_date: "2026-11-20",
            locked_base_price: 500,
            locked_minimum_days: 1,
            locked_extra_daily_rate: 500,
            borrow_quantity: 2,
            good_returned_qty: 0,
            defective_returned_qty: 0,
            line_total_amount: 1000,
            line_status: "Active",
            track_overdue: true,
          },
        ],
    payments: [...payments],
    reviews: [],
    equipment: [
      { equipment_id: 5, equipment_name: "Drill", available_qty: 10, rented_qty: 2, defective_qty: 0 },
    ],
    customers: [
      {
        customer_id: 10,
        first_name: "Kasun",
        last_name: "Perera",
        customer_type: "Individual",
        deposit_balance: 0,
        is_id_retained_currently: true,
        rating: 5,
      },
    ],
    users: [
      {
        user_id: 1,
        first_name: "Admin",
        last_name: "User",
        username: "admin",
        is_active: true,
        Roles: [{ role_id: 1, role_name: "Administrator", hierarchy_level: 100, is_active: true }],
      },
      {
        user_id: 2,
        first_name: "Nimal",
        last_name: "Cashier",
        username: "nimal",
        is_active: true,
        Roles: [{ role_id: 3, role_name: "Cashier", hierarchy_level: 10, is_active: true }],
      },
    ],
  };

  const configRow = {
    timezone,
    custom_settings: {
      phone_assistant: {
        call_logging: { business_hours: { from: "08:00", to: "18:00" } },
        push: {
          events: Object.fromEntries(
            ACTIVITY_EVENT_TYPES.map((k) => [
              k === "payment" ? "payment_received" : k === "return" ? "return_processed" : k,
              { enabled: true, min_amount: 0, recipient_role_ids: [1, 3], delivery: "instant" },
            ]),
          ),
          quiet_hours: { enabled: false, from: "21:00", to: "07:00" },
          include_amounts: true,
          notify_actor: true,
          daily_summary: { enabled: true, recipient_role_ids: [1], sections: { bills: true, payments: true, returns: true } },
        },
      },
      ...customSettings,
    },
    update: vi.fn(async (patch) => {
      if (patch.custom_settings) configRow.custom_settings = patch.custom_settings;
      return configRow;
    }),
  };

  const wrapRow = (obj) => {
    const inst = {
      ...obj,
      toJSON: () => ({ ...obj }),
      reload: vi.fn(async () => inst),
      destroy: vi.fn(async () => true),
    };
    inst.update = vi.fn(async (patch) => {
      Object.assign(obj, patch);
      Object.assign(inst, patch);
      return inst;
    });
    return inst;
  };

  const makeTx = () => {
    const callbacks = [];
    const t = {
      LOCK: { UPDATE: "UPDATE" },
      afterCommit: (fn) => callbacks.push(fn),
      _runAfterCommit: () => callbacks.forEach((fn) => fn()),
    };
    return t;
  };

  const models = {
    store,
    configRow,
    sequelize: {
      Sequelize,
      fn: (name, col) => ({ fn: name, col }),
      col: (c) => c,
      literal: (s) => s,
      escape: (v) => String(v),
      config: { database: "test_db" },
      transaction: async (fn) => {
        const t = makeTx();
        const res = await fn(t);
        t._runAfterCommit();
        return res;
      },
    },
    TenantConfig: {
      findOne: vi.fn(async () => configRow),
    },
    ActivityEvent: {
      create: vi.fn(async (data) => {
        await assertSavable(realModels.ActivityEvent, data);
        const row = {
          event_id: store.events.length + 1,
          ...data,
          checked_by: null,
          checked_at: null,
          created_at: new Date(),
        };
        store.events.push(row);
        return wrapRow(row);
      }),
      findByPk: vi.fn(async (id) => {
        const row = store.events.find((e) => e.event_id === Number(id));
        return row ? wrapRow(row) : null;
      }),
      findAll: vi.fn(async () => store.events.map(wrapRow)),
      count: vi.fn(async ({ where } = {}) => {
        if (where?.checked_at === null) {
          return store.events.filter((e) => !e.checked_at).length;
        }
        return store.events.length;
      }),
    },
    ActivityEventComment: {
      create: vi.fn(async (data) => {
        await assertSavable(realModels.ActivityEventComment, data);
        const row = { comment_id: store.comments.length + 1, ...data, created_at: new Date() };
        store.comments.push(row);
        return wrapRow(row);
      }),
      findAll: vi.fn(async ({ where } = {}) =>
        store.comments
          .filter((c) => (where?.event_id ? Number(c.event_id) === Number(where.event_id) : true))
          .map(wrapRow),
      ),
    },
    ActivityEventRead: {
      findOne: vi.fn(async ({ where } = {}) => {
        const found = store.reads.find(
          (r) => Number(r.event_id) === Number(where.event_id) && Number(r.user_id) === Number(where.user_id),
        );
        return found ? wrapRow(found) : null;
      }),
      create: vi.fn(async (data) => {
        await assertSavable(realModels.ActivityEventRead, data);
        const row = { ...data };
        store.reads.push(row);
        return wrapRow(row);
      }),
      findAll: vi.fn(async () => store.reads.map(wrapRow)),
    },
    Invoice: {
      create: vi.fn(async (data) => {
        const row = { invoice_id: store.invoices.length + 101, accrued_charges: 0, accrued_rental: 0, ...data };
        store.invoices.push(row);
        return wrapRow(row);
      }),
      findByPk: vi.fn(async (id) => {
        const row = store.invoices.find((i) => Number(i.invoice_id) === Number(id));
        if (!row) return null;
        const wrapped = wrapRow(row);
        const cust = store.customers.find((c) => c.customer_id === row.customer_id);
        wrapped.Customer = cust ? wrapRow(cust) : null;
        wrapped.InvoiceLines = store.lines.filter((l) => l.invoice_id === row.invoice_id).map(wrapRow);
        return wrapped;
      }),
      findAll: vi.fn(async () => store.invoices.map(wrapRow)),
      unscoped: () => ({
        findByPk: vi.fn(async (id) => {
          const row = store.invoices.find((i) => Number(i.invoice_id) === Number(id));
          return row ? wrapRow(row) : null;
        }),
      }),
    },
    InvoiceLine: {
      bulkCreate: vi.fn(async (items) => {
        for (const it of items) {
          store.lines.push({ line_id: store.lines.length + 1, good_returned_qty: 0, defective_returned_qty: 0, ...it });
        }
        return items;
      }),
      findAll: vi.fn(async ({ where } = {}) =>
        store.lines.filter((l) => Number(l.invoice_id) === Number(where.invoice_id)).map(wrapRow),
      ),
      findByPk: vi.fn(async (id) => {
        const row = store.lines.find((l) => Number(l.line_id) === Number(id));
        return row ? wrapRow(row) : null;
      }),
      count: vi.fn(async ({ where } = {}) =>
        store.lines.filter((l) => Number(l.invoice_id) === Number(where.invoice_id) && l.line_status === where.line_status).length,
      ),
    },
    Payment: {
      create: vi.fn(async (data) => {
        await assertSavable(realModels.Payment, data);
        const row = { payment_id: store.payments.length + 1, is_voided: false, ...data };
        store.payments.push(row);
        return wrapRow(row);
      }),
      findAll: vi.fn(async ({ where } = {}) =>
        store.payments
          .filter((p) => Number(p.invoice_id) === Number(where.invoice_id) && (where.is_voided === undefined || p.is_voided === where.is_voided))
          .map(wrapRow),
      ),
      sum: vi.fn(async (_field, { where } = {}) =>
        store.payments
          .filter((p) => Number(p.invoice_id) === Number(where.invoice_id) && !p.is_voided)
          .reduce((s, p) => s + Number(p.payment_amount || 0), 0),
      ),
      update: vi.fn(async (patch, { where } = {}) => {
        for (const p of store.payments) {
          if (Number(p.invoice_id) === Number(where.invoice_id) && p.is_voided === where.is_voided) {
            Object.assign(p, patch);
          }
        }
        return [1];
      }),
      unscoped: () => ({
        findAll: vi.fn(async ({ where } = {}) =>
          store.payments.filter((p) => Number(p.invoice_id) === Number(where.invoice_id) && p.is_voided === where.is_voided).map(wrapRow),
        ),
        update: vi.fn(async (patch, { where } = {}) => {
          for (const p of store.payments) {
            if (Number(p.invoice_id) === Number(where.invoice_id) && p.is_voided === where.is_voided) {
              Object.assign(p, patch);
            }
          }
          return [1];
        }),
      }),
    },
    Equipment: {
      findByPk: vi.fn(async (id) => {
        const row = store.equipment.find((e) => Number(e.equipment_id) === Number(id));
        return row ? wrapRow(row) : null;
      }),
    },
    DefectLog: { create: vi.fn(async (d) => d) },
    InvoiceTrace: { create: vi.fn(async (d) => d) },
    InvoicePrintLog: {
      count: vi.fn(async () => printLogsCount),
    },
    InvoiceReview: {
      create: vi.fn(async (data) => {
        await assertSavable(realModels.InvoiceReview, data);
        const row = { review_id: store.reviews.length + 1, ...data };
        store.reviews.push(row);
        return wrapRow(row);
      }),
      update: vi.fn(async () => [0]),
      findOne: vi.fn(async () => ({ avg_rating: 4 })),
    },
    Customer: {
      findByPk: vi.fn(async (id) => {
        const row = store.customers.find((c) => Number(c.customer_id) === Number(id));
        return row ? wrapRow(row) : null;
      }),
      update: vi.fn(async () => [1]),
    },
    User: {
      findByPk: vi.fn(async (id) => store.users.find((u) => Number(u.user_id) === Number(id)) ?? null),
      findAll: vi.fn(async () => store.users),
    },
    Role: {},
    PushPreference: { findAll: vi.fn(async () => []) },
  };

  return models;
};

describe("Slice 1: Activity Feed, Reasons, Dates & Review Tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenantPlan.mockResolvedValue(null);
  });

  it("validates ActivityEvent ENUMs and required columns against real Sequelize model rules", async () => {
    await expect(
      assertSavable(realModels.ActivityEvent, { type: "invalid_type", risk: "normal" }),
    ).rejects.toThrow();
    await expect(
      assertSavable(realModels.ActivityEvent, { type: "discount", risk: "extreme" }),
    ).rejects.toThrow();
    await expect(
      assertSavable(realModels.ActivityEvent, {
        type: "discount",
        risk: "high",
        invoice_id: 1,
        amount: 500,
        data: { sentence: { en: "Discount Rs 500", si: "වට්ටම Rs 500" } },
      }),
    ).resolves.toBeTruthy();
  });

  it("computes after_hours from shop business hours and marks outside-hours events as high", async () => {
    const models = makeFakeStore();
    // 20:00 Asia/Colombo = 14:30 UTC (outside 08:00-18:00)
    const lateEvent = await recordActivity(models, {
      type: "payment",
      invoice_id: 101,
      customer_id: 10,
      actor_user_id: 2,
      amount: 1000,
      occurred_at: new Date("2026-11-25T14:30:00Z"),
    });
    expect(lateEvent.after_hours).toBe(true);
    expect(lateEvent.risk).toBe("high");
    expect(lateEvent.data.sentence.en).toContain("Payment");
    expect(lateEvent.data.sentence.si).toBeTruthy();

    // 10:00 Asia/Colombo = 04:30 UTC (inside 08:00-18:00)
    const dayEvent = await recordActivity(models, {
      type: "payment",
      invoice_id: 101,
      customer_id: 10,
      actor_user_id: 2,
      amount: 1000,
      occurred_at: new Date("2026-11-25T04:30:00Z"),
    });
    expect(dayEvent.after_hours).toBe(false);
    expect(dayEvent.risk).toBe("normal");
  });

  it("applies High rules for discount, backdate, refund, damaged return, void/delete, ID card, and review", async () => {
    const models = makeFakeStore();
    const dayTime = new Date("2026-11-25T04:30:00Z");

    const smallDisc = await recordActivity(models, {
      type: "discount",
      amount: 500,
      data: { discount_pct: 5 },
      occurred_at: dayTime,
    });
    expect(smallDisc.risk).toBe("normal");

    const pctHighDisc = await recordActivity(models, {
      type: "discount",
      amount: 500,
      data: { discount_pct: 15 },
      occurred_at: dayTime,
    });
    expect(pctHighDisc.risk).toBe("high");

    const amtHighDisc = await recordActivity(models, {
      type: "discount",
      amount: 6000,
      data: { discount_pct: 5 },
      occurred_at: dayTime,
    });
    expect(amtHighDisc.risk).toBe("high");

    const printHighDisc = await recordActivity(models, {
      type: "discount",
      amount: 100,
      data: { discount_pct: 1, raised_after_printing: true },
      occurred_at: dayTime,
    });
    expect(printHighDisc.risk).toBe("high");

    const back2 = await recordActivity(models, {
      type: "backdated_payment",
      amount: 1000,
      data: { days_back: 2 },
      occurred_at: dayTime,
    });
    expect(back2.risk).toBe("normal");

    const back3 = await recordActivity(models, {
      type: "backdated_payment",
      amount: 1000,
      data: { days_back: 3 },
      occurred_at: dayTime,
    });
    expect(back3.risk).toBe("high");

    const backRet = await recordActivity(models, {
      type: "backdated_return",
      amount: 500,
      data: { days_back: 1, late_fee_difference: 500 },
      occurred_at: dayTime,
    });
    expect(backRet.risk).toBe("high");

    const highRefund = await recordActivity(models, {
      type: "refund",
      amount: 5500,
      occurred_at: dayTime,
    });
    expect(highRefund.risk).toBe("high");

    const dmgReturn = await recordActivity(models, {
      type: "return",
      data: { damaged_qty: 1, has_damaged: true },
      occurred_at: dayTime,
    });
    expect(dmgReturn.risk).toBe("high");

    const idUnpaid = await recordActivity(models, {
      type: "id_card_released_unpaid",
      amount: 4000,
      occurred_at: dayTime,
    });
    expect(idUnpaid.risk).toBe("high");
  });

  it("enforces reason_required on every discount path and requires a note for Other", async () => {
    const models = makeFakeStore();

    // Bill creation with discount > 0 without reason -> 400 reason_required
    await expect(
      createDispatchInvoice(
        models,
        {
          customer_id: 10,
          items: [
            {
              equipment_id: 5,
              borrow_date: "2026-11-25",
              expected_return_date: "2026-11-26",
              locked_base_price: 1000,
              locked_minimum_days: 1,
              locked_extra_daily_rate: 1000,
              borrow_quantity: 1,
            },
          ],
          fees: { transport: 0, discount: 100, advance: 0 },
        },
        2,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "reason_required" });

    // Other without note -> 400 reason_required
    await expect(
      validateReason(models, "discount", { key: "other", note: "   " }),
    ).rejects.toMatchObject({ statusCode: 400, code: "reason_required" });

    // Valid discount at creation stores reason on invoice and records discount event
    const inv = await createDispatchInvoice(
      models,
      {
        customer_id: 10,
        items: [
          {
            equipment_id: 5,
            borrow_date: "2026-11-25",
            expected_return_date: "2026-11-26",
            locked_base_price: 2000,
            locked_minimum_days: 1,
            locked_extra_daily_rate: 1000,
            borrow_quantity: 1,
          },
        ],
        fees: { transport: 0, discount: 200, advance: 0 },
        discount_reason: { key: "regular_customer", note: "VIP" },
      },
      2,
    );
    expect(inv.discount_reason_key).toBe("regular_customer");
    expect(inv.discount_reason_note).toBe("VIP");
    expect(models.store.events.some((e) => e.type === "invoice_created")).toBe(true);
    expect(models.store.events.some((e) => e.type === "discount")).toBe(true);

    // updateInvoiceFees without reason -> 400 reason_required
    await expect(
      updateInvoiceFees(models, 101, { discount_amount: 500 }, 2),
    ).rejects.toMatchObject({ statusCode: 400, code: "reason_required" });

    // updateInvoiceFees when print log exists marks raised_after_printing
    const printedModels = makeFakeStore({ printLogsCount: 1 });
    await updateInvoiceFees(
      printedModels,
      101,
      { discount_amount: 500, discount_reason: { key: "other", note: "Approved by owner" } },
      2,
    );
    const discEv = printedModels.store.events.find((e) => e.type === "discount");
    expect(discEv).toBeTruthy();
    expect(discEv.data.raised_after_printing).toBe(true);
    expect(discEv.risk).toBe("high");
  });

  it("handles payment_date (past ok, future 400, backdated_payment requires date_reason) and entered_at", async () => {
    const models = makeFakeStore();

    // Future payment date -> 400
    const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await expect(
      addContinuousPayment(models, 101, { amount: 1000, method: "Cash", payment_date: tomorrow }, 2),
    ).rejects.toMatchObject({ statusCode: 400 });

    // Back-dated payment without date_reason -> 400 reason_required
    const twoDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await expect(
      addContinuousPayment(models, 101, { amount: 1000, method: "Cash", payment_date: twoDaysAgo }, 2),
    ).rejects.toMatchObject({ statusCode: 400, code: "reason_required" });

    // Valid back-dated payment records entered_at and backdated_payment event
    const pay = await addContinuousPayment(
      models,
      101,
      {
        amount: 1500,
        method: "Cash",
        payment_date: twoDaysAgo,
        date_reason: { key: "forgot_to_enter" },
      },
      2,
    );
    expect(pay.entered_at).toBeTruthy();
    const bpEv = models.store.events.find((e) => e.type === "backdated_payment");
    expect(bpEv).toBeTruthy();
    expect(bpEv.data.days_back).toBeGreaterThanOrEqual(2);
  });

  it("handles actual_return_date (past ok, future 400, late fee to return date, late_fee_difference stored)", async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const models = makeFakeStore({
      lines: [
        {
          line_id: 1,
          invoice_id: 101,
          equipment_id: 5,
          borrow_date: fiveDaysAgo,
          expected_return_date: threeDaysAgo,
          locked_base_price: 500,
          locked_minimum_days: 1,
          locked_extra_daily_rate: 500,
          borrow_quantity: 1,
          good_returned_qty: 0,
          defective_returned_qty: 0,
          line_total_amount: 1500,
          line_status: "Active",
          track_overdue: true,
        },
      ],
    });

    // Future return date -> 400
    const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await expect(
      processReturn(
        models,
        {
          invoice_id: 101,
          actual_return_date: tomorrow,
          lines_returned: [{ line_id: 1, good_qty: 1, defective_qty: 0 }],
        },
        2,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    // Preview shows exact difference (2 days * 500 = 1000 less)
    const preview = await previewReturn(models, 101, {
      actual_return_date: twoDaysAgo,
      lines_returned: [{ line_id: 1, good_qty: 1, defective_qty: 0 }],
    });
    expect(preview.late_fee_difference).toBe(1000);

    await processReturn(
      models,
      {
        invoice_id: 101,
        actual_return_date: twoDaysAgo,
        date_reason: { key: "entered_at_site" },
        lines_returned: [{ line_id: 1, good_qty: 1, defective_qty: 0 }],
      },
      2,
    );

    const retEv = models.store.events.find((e) => e.type === "return");
    const backRetEv = models.store.events.find((e) => e.type === "backdated_return");
    expect(retEv).toBeTruthy();
    expect(backRetEv).toBeTruthy();
    expect(backRetEv.data.late_fee_difference).toBe(1000);
    expect(backRetEv.risk).toBe("high");
  });

  it("records activity on delete, restore, reopen, id_card_released_unpaid, and review tags", async () => {
    const models = makeFakeStore({
      payments: [{ payment_id: 1, invoice_id: 101, payment_amount: 2000, method: "Cash", is_voided: false }],
    });

    // ID card released with unpaid balance (10000 - 2000 = 8000)
    await toggleVaultStatus(models, 101, 2);
    const idEv = models.store.events.find((e) => e.type === "id_card_released_unpaid");
    expect(idEv).toBeTruthy();
    expect(Number(idEv.amount)).toBe(8000);
    expect(idEv.risk).toBe("high");

    // Review with negative tag
    const rev = await reviewService.create(
      models,
      101,
      { rating: 2, comment: "Returned dirty", tags: ["late", "damaged"] },
      2,
    );
    expect(rev.tags).toEqual(["late", "damaged"]);
    expect(rev.comment).toContain("Late");
    expect(rev.comment).toContain("Damaged");
    const revEv = models.store.events.find((e) => e.type === "review");
    expect(revEv).toBeTruthy();
    expect(revEv.risk).toBe("high");

    // Unknown review tag rejected
    await expect(
      reviewService.create(models, 101, { tags: ["nonexistent_tag"] }, 2),
    ).rejects.toMatchObject({ statusCode: 400 });

    // Delete & restore
    const actor = { userId: 1, permissions: new Set(["*"]) };
    await deleteInvoice(models, 101, actor, { reason: "Duplicate invoice" });
    expect(models.store.events.some((e) => e.type === "invoice_deleted")).toBe(true);
    expect(models.store.events.some((e) => e.type === "payment_voided")).toBe(true);

    await restoreInvoice(models, 101, actor);
    expect(models.store.events.some((e) => e.type === "invoice_restored")).toBe(true);

    // Reopen
    models.store.invoices[0].status = "Completed";
    await reopenInvoice(models, 101, 1);
    expect(models.store.events.some((e) => e.type === "invoice_reopened")).toBe(true);
  });

  it("supports idempotent check, uncheck, separate read state, and comments", async () => {
    const models = makeFakeStore();
    const ev = await recordActivity(models, {
      type: "discount",
      invoice_id: 101,
      customer_id: 10,
      actor_user_id: 2,
      amount: 1000,
    });

    // Read by user 1 does NOT check the event
    await markRead(models, [ev.event_id], 1);
    expect(models.store.reads).toHaveLength(1);
    expect(models.store.events[0].checked_at).toBeNull();

    // Check is idempotent
    const checked1 = await checkEvent(models, ev.event_id, 1);
    const firstCheckedAt = checked1.checked_at;
    expect(firstCheckedAt).toBeTruthy();

    const checked2 = await checkEvent(models, ev.event_id, 99);
    expect(checked2.checked_by).toBe(1);
    expect(checked2.checked_at).toEqual(firstCheckedAt);

    // Uncheck clears
    await uncheckEvent(models, ev.event_id);
    expect(models.store.events[0].checked_at).toBeNull();

    // Comment notifies actor
    await addComment(models, ev.event_id, 1, "Checked with customer");
    const comments = await listComments(models, ev.event_id);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("Checked with customer");
    expect(mockCreateNotification).toHaveBeenCalled();
  });

  it("pushes High events loudly even during quiet hours and respects activity_roles", async () => {
    const models = makeFakeStore({
      customSettings: {
        activity_roles: {
          "1": { types: ["discount", "payment"], see_amounts: true },
          "3": { types: ["payment"], see_amounts: false },
        },
      },
    });
    models.configRow.custom_settings.phone_assistant.push.quiet_hours = {
      enabled: true,
      from: "00:00",
      to: "23:59",
    };

    // High event during quiet hours -> loud push (silent: false)
    const highRes = await notifyEvent(models, "discount", {
      amount: 6000,
      actorUserId: 2,
      isHigh: true,
      activityType: "discount",
      title: "High discount",
      body: "Test",
    });
    expect(highRes.silent).toBe(false);
    expect(mockSendToUsers).toHaveBeenCalledWith(
      models,
      [1], // Only role 1 has "discount" in activity_roles!
      expect.objectContaining({ silent: false }),
    );
  });

  it("includes activity summary in daily_summary push", async () => {
    const models = makeFakeStore();
    await recordActivity(models, { type: "discount", amount: 6000, data: { discount_pct: 20 } });
    await recordActivity(models, { type: "discount", amount: 200, data: { discount_pct: 2 } });
    await recordActivity(models, { type: "backdated_payment", amount: 1000, data: { days_back: 1 } });

    const res = await sendDailySummaryPush(models);
    expect(res.body).toContain("2 discounts (1 high)");
    expect(res.body).toContain("1 back-dated payment");
    expect(res.body).toContain("not checked: 3");
  });

  it("filters, aggregates summary buckets, and exports Excel accurately with per-role visibility", async () => {
    const models = makeFakeStore({
      customSettings: {
        activity_roles: {
          "3": { types: ["payment"], see_amounts: false },
        },
      },
    });

    // Seed 3 events
    models.store.events.push(
      {
        event_id: 1,
        type: "discount",
        risk: "high",
        invoice_id: 101,
        customer_id: 10,
        actor_user_id: 2,
        amount: 6000,
        after_hours: false,
        checked_by: null,
        checked_at: null,
        occurred_at: new Date("2026-11-25T05:00:00Z"),
        data: { sentence: { en: "Discount Rs 6,000", si: "වට්ටම" } },
      },
      {
        event_id: 2,
        type: "payment",
        risk: "normal",
        invoice_id: 102,
        customer_id: 10,
        actor_user_id: 2,
        amount: 3000,
        after_hours: true,
        checked_by: 1,
        checked_at: new Date(),
        occurred_at: new Date("2026-11-25T15:00:00Z"),
        data: { sentence: { en: "Payment Rs 3,000", si: "ගෙවීම" } },
      },
    );

    // Mock findAndCountAll & SQL group queries to verify filter wiring and totals
    models.ActivityEvent.findAndCountAll = vi.fn(async ({ where }) => {
      let rows = [...models.store.events];
      if (where.type?.[Op.in]) {
        const list = where.type[Op.in];
        rows = rows.filter((r) => list.includes(r.type));
      }
      if (where.risk) rows = rows.filter((r) => r.risk === where.risk);
      if (where.after_hours !== undefined) rows = rows.filter((r) => r.after_hours === where.after_hours);
      if (where.checked_at === null) rows = rows.filter((r) => !r.checked_at);
      return { count: rows.length, rows: rows.map((r) => ({ ...r, toJSON: () => ({ ...r }) })) };
    });

    // Cashier (role 3) sees only payment and amounts masked as null
    const cashierList = await listActivity(models, {}, { userId: 2, roleIds: [3] });
    expect(cashierList.see_amounts).toBe(false);
    expect(cashierList.events).toHaveLength(1);
    expect(cashierList.events[0].type).toBe("payment");
    expect(cashierList.events[0].amount).toBeNull();

    // Admin sees all with amounts
    const adminList = await listActivity(models, { risk: "high" }, { userId: 1, roleIds: [1] });
    expect(adminList.see_amounts).toBe(true);
    expect(adminList.events).toHaveLength(1);
    expect(adminList.events[0].amount).toBe(6000);

    // Excel export returns valid xlsx buffer
    const buf = await exportActivityExcel(models, {}, { userId: 1, roleIds: [1] });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);

    // Settings update & read
    const updated = await updateActivitySettings(models, {
      activity: { discountHighPct: 15 },
    });
    expect(updated.activity.discountHighPct).toBe(15);
    const fetched = await getActivitySettings(models);
    expect(fetched.reasons.discount.some((r) => r.key === "other")).toBe(true);

    // Summary aggregation
    models.ActivityEvent.findAll = vi.fn(async ({ group }) => {
      if (group?.includes("type") && group.length === 1) {
        return [
          { type: "discount", count: 1, amount: 6000, high_count: 1 },
          { type: "payment", count: 1, amount: 3000, high_count: 0 },
        ];
      }
      if (group?.includes("actor_user_id")) {
        return [{ actor_user_id: 2, type: "discount", count: 1, amount: 6000 }];
      }
      return [
        { bucket: "2026-11-25", type: "discount", count: 1, amount: 6000 },
        { bucket: "2026-11-25", type: "payment", count: 1, amount: 3000 },
      ];
    });
    const summary = await getActivitySummary(models, {}, { userId: 1, roleIds: [1], canCheck: true });
    expect(summary.totals.count).toBe(2);
    expect(summary.totals.amount).toBe(9000);
    expect(summary.totals.high_count).toBe(1);
    expect(summary.by_staff).toHaveLength(1);
    expect(summary.by_staff[0].discounts).toBe(1);
  });
});
