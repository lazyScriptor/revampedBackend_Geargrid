import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Sequelize } from "sequelize";
import { initTenantModels } from "../../src/models/index.js";
import { processReturn, completeInvoice } from "../../src/services/invoiceService.js";
import {
  getSettlementOverview,
  getCustomerOpenBills,
  previewSettlement,
  saveSettlement,
  completeSettlementBills,
  voidSettlement,
  getSettlementById,
  SettlementChangedError,
} from "../../src/services/customerSettlementService.js";
import { settlementIdempotency } from "../../src/middlewares/settlementIdempotency.js";

const dummySeq = new Sequelize("mysql://user:pass@localhost:3306/dummy", { logging: false });
const realModels = initTenantModels(dummySeq);

const assertSavable = async (Model, data) => {
  const inst = Model.build(data);
  await inst.validate();
  return inst;
};

/**
 * Stateful in-memory Sequelize harness with real model validation for testing
 * processReturn, previewSettlement, saveSettlement, voidSettlement, completeBills, and idempotency.
 */
function createStatefulHarness(seed = {}) {
  const state = {
    customers: new Map(),
    equipment: new Map(),
    invoices: new Map(),
    lines: new Map(),
    payments: [],
    defectLogs: [],
    traces: [],
    settlements: new Map(),
    activities: [],
    idempotencyKeys: [],
    nextSettlementId: 100,
    nextPaymentId: 1000,
    nextDefectId: 500,
    nextTraceId: 2000,
    nextActivityId: 3000,
    nextIdemId: 1,
  };

  const wrapCustomer = (raw) => {
    const obj = { ...raw };
    obj.update = async (patch) => {
      Object.assign(obj, patch);
      state.customers.set(obj.customer_id, obj);
      return obj;
    };
    return obj;
  };

  const wrapEquipment = (raw) => {
    const obj = { ...raw };
    obj.update = async (patch) => {
      Object.assign(obj, patch);
      state.equipment.set(obj.equipment_id, obj);
      return obj;
    };
    return obj;
  };

  const wrapLine = (raw) => {
    const obj = { ...raw };
    obj.get = () => ({ ...obj });
    obj.update = async (patch) => {
      Object.assign(obj, patch);
      state.lines.set(obj.line_id, obj);
      return obj;
    };
    return obj;
  };

  const wrapInvoice = (raw) => {
    const obj = { ...raw };
    obj.update = async (patch) => {
      Object.assign(obj, patch);
      state.invoices.set(obj.invoice_id, obj);
      return obj;
    };
    return obj;
  };

  const wrapSettlement = (raw) => {
    const obj = { ...raw };
    obj.update = async (patch) => {
      Object.assign(obj, patch);
      state.settlements.set(obj.settlement_id, obj);
      return obj;
    };
    return obj;
  };

  for (const c of seed.customers || []) state.customers.set(c.customer_id, wrapCustomer(c));
  for (const e of seed.equipment || []) state.equipment.set(e.equipment_id, wrapEquipment(e));
  for (const i of seed.invoices || []) state.invoices.set(i.invoice_id, wrapInvoice(i));
  for (const l of seed.lines || []) state.lines.set(l.line_id, wrapLine(l));
  for (const p of seed.payments || []) state.payments.push({ is_voided: false, ...p });

  const attachRelations = (inv) => {
    if (!inv) return null;
    const lines = [...state.lines.values()]
      .filter((l) => Number(l.invoice_id) === Number(inv.invoice_id))
      .sort((a, b) => a.line_id - b.line_id)
      .map((l) => {
        l.Equipment = state.equipment.get(Number(l.equipment_id)) || null;
        return l;
      });
    inv.InvoiceLines = lines;
    return inv;
  };

  const matchWhere = (row, where = {}) => {
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const syms = Object.getOwnPropertySymbols(v);
        if (syms.length > 0) {
          for (const sym of syms) {
            const name = sym.description;
            if (name === "in" && !v[sym].includes(row[k])) return false;
            if (name === "gt" && !(Number(row[k]) > Number(v[sym]))) return false;
          }
          continue;
        }
      }
      if (row[k] !== v) return false;
    }
    return true;
  };

  const models = {
    sequelize: {
      LOCK: { UPDATE: "UPDATE" },
      transaction: async (fn) => fn({ LOCK: { UPDATE: "UPDATE" } }),
      query: vi.fn(async () => []),
    },
    TenantConfig: {
      findOne: vi.fn(async () => ({
        timezone: "Asia/Colombo",
        custom_settings: {},
      })),
    },
    Customer: {
      findByPk: vi.fn(async (id) => state.customers.get(Number(id)) || null),
      update: vi.fn(async (patch, { where }) => {
        let n = 0;
        for (const c of state.customers.values()) {
          if (matchWhere(c, where)) {
            Object.assign(c, patch);
            n++;
          }
        }
        return [n];
      }),
    },
    Equipment: {
      findByPk: vi.fn(async (id) => state.equipment.get(Number(id)) || null),
    },
    Invoice: {
      findByPk: vi.fn(async (id) => attachRelations(state.invoices.get(Number(id)) || null)),
      findAll: vi.fn(async ({ where = {}, order = [] } = {}) => {
        let rows = [...state.invoices.values()].filter((i) => matchWhere(i, where));
        if (order.length && order[0][0] === "invoice_id") {
          rows.sort((a, b) => a.invoice_id - b.invoice_id);
        }
        return rows.map(attachRelations);
      }),
    },
    InvoiceLine: {
      findByPk: vi.fn(async (id) => state.lines.get(Number(id)) || null),
      findAll: vi.fn(async ({ where = {} } = {}) =>
        [...state.lines.values()]
          .filter((l) => matchWhere(l, where))
          .sort((a, b) => a.line_id - b.line_id)
          .map((l) => {
            l.Equipment = state.equipment.get(Number(l.equipment_id)) || null;
            return l;
          }),
      ),
      count: vi.fn(async ({ where = {} } = {}) =>
        [...state.lines.values()].filter((l) => matchWhere(l, where)).length,
      ),
    },
    Payment: {
      create: vi.fn(async (data) => {
        await assertSavable(realModels.Payment, data);
        const row = { payment_id: state.nextPaymentId++, is_voided: false, ...data };
        state.payments.push(row);
        return row;
      }),
      findAll: vi.fn(async ({ where = {} } = {}) =>
        state.payments.filter((p) => matchWhere(p, where)),
      ),
      findOne: vi.fn(async () => state.payments[0] || null),
      sum: vi.fn(async (col, { where = {} } = {}) =>
        state.payments
          .filter((p) => matchWhere(p, where))
          .reduce((s, p) => s + Number(p[col] || 0), 0),
      ),
      update: vi.fn(async (patch, { where = {} } = {}) => {
        let n = 0;
        for (const p of state.payments) {
          if (matchWhere(p, where)) {
            Object.assign(p, patch);
            n++;
          }
        }
        return [n];
      }),
    },
    DefectLog: {
      create: vi.fn(async (data) => {
        await assertSavable(realModels.DefectLog, data);
        const row = { defect_id: state.nextDefectId++, ...data };
        state.defectLogs.push(row);
        return row;
      }),
    },
    InvoiceTrace: {
      create: vi.fn(async (data) => {
        const row = { trace_id: state.nextTraceId++, ...data };
        state.traces.push(row);
        return row;
      }),
    },
    CustomerSettlement: {
      create: vi.fn(async (data) => {
        await assertSavable(realModels.CustomerSettlement, data);
        const row = wrapSettlement({ settlement_id: state.nextSettlementId++, ...data });
        state.settlements.set(row.settlement_id, row);
        return row;
      }),
      findByPk: vi.fn(async (id) => {
        const s = state.settlements.get(Number(id)) || null;
        if (s) {
          s.Customer = state.customers.get(Number(s.customer_id)) || null;
        }
        return s;
      }),
    },
    ActivityEvent: {
      create: vi.fn(async (data) => {
        await assertSavable(realModels.ActivityEvent, data);
        const row = { event_id: state.nextActivityId++, ...data };
        state.activities.push(row);
        return row;
      }),
    },
    SettlementIdempotencyKey: {
      create: vi.fn(async (data) => {
        await assertSavable(realModels.SettlementIdempotencyKey, data);
        const dup = state.idempotencyKeys.find(
          (k) => k.scope === data.scope && k.idempotency_key === data.idempotency_key,
        );
        if (dup) {
          const err = new Error("Duplicate");
          err.name = "SequelizeUniqueConstraintError";
          throw err;
        }
        const row = {
          id: state.nextIdemId++,
          ...data,
          update: async (patch) => Object.assign(row, patch),
          destroy: async () => {
            const idx = state.idempotencyKeys.indexOf(row);
            if (idx >= 0) state.idempotencyKeys.splice(idx, 1);
          },
        };
        state.idempotencyKeys.push(row);
        return row;
      }),
      findOne: vi.fn(async ({ where }) =>
        state.idempotencyKeys.find(
          (k) => k.scope === where.scope && k.idempotency_key === where.idempotency_key,
        ) || null,
      ),
    },
    User: {
      findByPk: vi.fn(async (id) => ({ user_id: id, first_name: "Kasun", last_name: "Silva", username: "kasun" })),
    },
    Notification: { create: vi.fn(async () => ({})) },
    PushPreference: { findAll: vi.fn(async () => []) },
  };

  return { models, state };
}

function build3BillSeed() {
  return {
    customers: [
      {
        customer_id: 1,
        customer_type: "Individual",
        first_name: "Nimal",
        last_name: "Perera",
        phone_number: "0771112223",
        nic_number: "901234567V",
        deposit_balance: 1500,
        is_id_retained_currently: true,
        rating: 5,
        status: "Active",
        customer_delete_status: false,
      },
    ],
    equipment: [
      {
        equipment_id: 10,
        equipment_name: "Scaffolding Frame",
        is_bulk_item: true,
        serial_number: null,
        total_owned_qty: 100,
        available_qty: 60,
        rented_qty: 40,
        defective_qty: 0,
      },
      {
        equipment_id: 20,
        equipment_name: "Concrete Mixer #M1",
        is_bulk_item: false,
        serial_number: "MIX-001",
        total_owned_qty: 1,
        available_qty: 0,
        rented_qty: 1,
        defective_qty: 0,
      },
    ],
    invoices: [
      // Bill 1: Oldest, overdue by 5 days, high daily rate 100/day -> returning 10 saves 500
      {
        invoice_id: 101,
        customer_id: 1,
        issued_date: "2026-11-10T09:00:00Z",
        status: "Active",
        total_amount: 3000,
        sub_total: 3000,
        accrued_charges: 0,
        accrued_rental: 0,
        discount_amount: 0,
        transport_fee: 0,
        id_card_status: 1,
        is_deleted: false,
      },
      // Bill 2: Middle, inside minimum days (due 2026-11-28, min_days 5, rate 80) -> returning costs 0 late fee!
      {
        invoice_id: 102,
        customer_id: 1,
        issued_date: "2026-11-23T09:00:00Z",
        status: "Active",
        total_amount: 4000,
        sub_total: 4000,
        accrued_charges: 0,
        accrued_rental: 0,
        discount_amount: 0,
        transport_fee: 0,
        id_card_status: 0,
        is_deleted: false,
      },
      // Bill 3: Newest, overdue by 2 days, rate 50/day -> returning 10 costs 1000
      {
        invoice_id: 103,
        customer_id: 1,
        issued_date: "2026-11-18T09:00:00Z",
        status: "Active",
        total_amount: 2000,
        sub_total: 2000,
        accrued_charges: 0,
        accrued_rental: 0,
        discount_amount: 0,
        transport_fee: 0,
        id_card_status: 0,
        is_deleted: false,
      },
    ],
    lines: [
      {
        line_id: 1,
        invoice_id: 101,
        equipment_id: 10,
        borrow_date: "2026-11-10",
        expected_return_date: "2026-11-20",
        locked_base_price: 200,
        locked_minimum_days: 1,
        locked_extra_daily_rate: 100,
        line_total_amount: 3000,
        borrow_quantity: 15,
        good_returned_qty: 0,
        defective_returned_qty: 0,
        line_status: "Active",
        track_overdue: true,
      },
      {
        line_id: 2,
        invoice_id: 102,
        equipment_id: 10,
        borrow_date: "2026-11-23",
        expected_return_date: "2026-11-28",
        locked_base_price: 400,
        locked_minimum_days: 5,
        locked_extra_daily_rate: 80,
        line_total_amount: 4000,
        borrow_quantity: 15,
        good_returned_qty: 0,
        defective_returned_qty: 0,
        line_status: "Active",
        track_overdue: true,
      },
      {
        line_id: 3,
        invoice_id: 103,
        equipment_id: 10,
        borrow_date: "2026-11-18",
        expected_return_date: "2026-11-23",
        locked_base_price: 200,
        locked_minimum_days: 1,
        locked_extra_daily_rate: 50,
        line_total_amount: 2000,
        borrow_quantity: 10,
        good_returned_qty: 0,
        defective_returned_qty: 0,
        line_status: "Active",
        track_overdue: true,
      },
      {
        line_id: 4,
        invoice_id: 103,
        equipment_id: 20,
        borrow_date: "2026-11-18",
        expected_return_date: "2026-11-23",
        locked_base_price: 1000,
        locked_minimum_days: 1,
        locked_extra_daily_rate: 500,
        line_total_amount: 1000,
        borrow_quantity: 1,
        good_returned_qty: 0,
        defective_returned_qty: 0,
        line_status: "Active",
        track_overdue: true,
      },
    ],
    payments: [],
  };
}

describe("Release 4 Slice 3: Customer Settlement Backend", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T12:00:00+05:30"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("1. partial return split oldest-first vs cheaper_for_customer matches single-bill processReturn to the cent", async () => {
    // A. Oldest-first via settlement preview + save (20 units of scaffolding)
    const { models: mOldest, state: sOldest } = createStatefulHarness(build3BillSeed());
    const previewOldest = await previewSettlement(mOldest, 1, {
      returns: [{ equipment_id: 10, qty: 20, damaged_qty: 0 }],
      split_rule: "oldest_first",
    });

    // Bill 101 (15 units, 5 days late @ 100 = 7500), Bill 103 (5 units, 2 days late @ 50 = 500)
    // Wait: Bill 102 is issued 2026-11-23, Bill 103 is issued 2026-11-18! So oldest_first is 101 -> 103 -> 102.
    expect(previewOldest.totals.total_late_fees).toBe(8000);
    expect(previewOldest.cheaper_alternative.available).toBe(true);
    // Cheaper for customer: Bill 102 (15 units @ 0 = 0) + Bill 103 (5 units @ 100 = 500) -> saves 7500!
    expect(previewOldest.cheaper_alternative.total_late_fees).toBe(500);
    expect(previewOldest.cheaper_alternative.saving).toBe(7500);

    // Compare oldest-first against single-bill processReturn calls
    const { models: mSingle1 } = createStatefulHarness(build3BillSeed());
    await processReturn(mSingle1, { invoice_id: 101, lines_returned: [{ line_id: 1, good_qty: 15, defective_qty: 0 }] }, 1);
    await processReturn(mSingle1, { invoice_id: 103, lines_returned: [{ line_id: 3, good_qty: 5, defective_qty: 0 }] }, 1);
    const inv101Single = await mSingle1.Invoice.findByPk(101);
    const inv103Single = await mSingle1.Invoice.findByPk(103);

    const savedOldest = await saveSettlement(mOldest, 1, {
      returns: [{ equipment_id: 10, qty: 20, damaged_qty: 0 }],
      split_rule: "oldest_first",
      preview_version: previewOldest.preview_version,
    }, 1);
    expect(savedOldest.totals.total_late_fees).toBe(8000);
    expect(sOldest.invoices.get(101).total_amount).toBe(inv101Single.total_amount);
    expect(sOldest.invoices.get(103).total_amount).toBe(inv103Single.total_amount);

    // B. Cheaper-for-customer via settlement save vs single-bill processReturn calls
    const { models: mCheaper, state: sCheaper } = createStatefulHarness(build3BillSeed());
    const previewCheaper = await previewSettlement(mCheaper, 1, {
      returns: [{ equipment_id: 10, qty: 20, damaged_qty: 0 }],
      split_rule: "cheaper_for_customer",
    });
    expect(previewCheaper.totals.total_late_fees).toBe(500);
    await saveSettlement(mCheaper, 1, {
      returns: [{ equipment_id: 10, qty: 20, damaged_qty: 0 }],
      split_rule: "cheaper_for_customer",
      preview_version: previewCheaper.preview_version,
    }, 1);

    const { models: mSingle2 } = createStatefulHarness(build3BillSeed());
    await processReturn(mSingle2, { invoice_id: 102, lines_returned: [{ line_id: 2, good_qty: 15, defective_qty: 0 }] }, 1);
    await processReturn(mSingle2, { invoice_id: 103, lines_returned: [{ line_id: 3, good_qty: 5, defective_qty: 0 }] }, 1);
    expect(sCheaper.invoices.get(102).total_amount).toBe((await mSingle2.Invoice.findByPk(102)).total_amount);
    expect(sCheaper.invoices.get(103).total_amount).toBe((await mSingle2.Invoice.findByPk(103)).total_amount);
  });

  it("2. handles damaged units (equipment defective_qty + DefectLog) and serial machines never split", async () => {
    const { models, state } = createStatefulHarness(build3BillSeed());
    await expect(
      previewSettlement(models, 1, {
        returns: [{ equipment_id: 20, qty: 2, damaged_qty: 0 }],
      }),
    ).rejects.toThrow(/only has 1 unit/i);

    const preview = await previewSettlement(models, 1, {
      returns: [
        { equipment_id: 10, qty: 5, damaged_qty: 2 },
        { equipment_id: 20, qty: 1, damaged_qty: 0 },
      ],
    });
    const saved = await saveSettlement(
      models,
      1,
      {
        returns: [
          { equipment_id: 10, qty: 5, damaged_qty: 2 },
          { equipment_id: 20, qty: 1, damaged_qty: 0 },
        ],
        preview_version: preview.preview_version,
      },
      1,
    );

    expect(saved.totals.damaged_qty).toBe(2);
    expect(state.equipment.get(10).available_qty).toBe(63);
    expect(state.equipment.get(10).defective_qty).toBe(2);
    expect(state.equipment.get(10).rented_qty).toBe(35);
    expect(state.defectLogs.length).toBe(1);
    expect(state.defectLogs[0].defective_quantity).toBe(2);
    expect(state.lines.get(4).line_status).toBe("Returned");
    expect(state.lines.get(4).settlement_id).toBe(saved.settlement_id);
  });

  it("3. shares payments in queue order (now fully back first), honours overrides, discounts with reasons, and two methods", async () => {
    const seed = build3BillSeed();
    // Add an already-PendingPayment bill 100
    seed.invoices.unshift({
      invoice_id: 100,
      customer_id: 1,
      issued_date: "2026-11-05T09:00:00Z",
      status: "PendingPayment",
      total_amount: 1000,
      sub_total: 1000,
      accrued_charges: 0,
      accrued_rental: 0,
      discount_amount: 0,
      transport_fee: 0,
      id_card_status: 0,
      is_deleted: false,
    });
    const { models, state } = createStatefulHarness(seed);

    // Discount without reason -> 400 reason_required
    await expect(
      previewSettlement(models, 1, {
        discounts: [{ invoice_id: 100, amount: 200 }],
      }),
    ).rejects.toThrow();

    // Return all 15 of equipment 10 on bill 101 (so bill 101 is NOW FULLY BACK -> queue #1 ahead of 100!)
    // Bill 101 total = 3000 + 7500 = 10500. Discount 500 -> balance 10000.
    // Pay 6000 Cash + 5000 Bank Transfer = 11000 -> 10000 to bill 101, 800 to bill 100 (after 200 discount? no, 1000 to bill 100).
    const payload = {
      returns: [{ equipment_id: 10, qty: 15, damaged_qty: 0 }],
      discounts: [{ invoice_id: 101, amount: 500, reason: { key: "regular_customer" } }],
      payments: [
        { amount: 6000, method: "Cash" },
        { amount: 5000, method: "Bank Transfer" },
      ],
    };
    const preview = await previewSettlement(models, 1, payload);
    const b101 = preview.bills.find((b) => b.invoice_id === 101);
    const b100 = preview.bills.find((b) => b.invoice_id === 100);
    expect(b101.queue_position).toBe(1);
    expect(b100.queue_position).toBe(2);
    expect(b101.changes.payment_applied).toBe(10000);
    expect(b101.stamps.ready_to_close).toBe(true);
    expect(b100.changes.payment_applied).toBe(1000);
    expect(b100.stamps.paid_off).toBe(true);

    const saved = await saveSettlement(
      models,
      1,
      { ...payload, preview_version: preview.preview_version },
      1,
    );
    expect(saved.totals.payment_total).toBe(11000);
    expect(state.payments.filter((p) => p.settlement_id === saved.settlement_id).length).toBe(3); // 6000 Cash + 4000 Transfer on 101, 1000 Transfer on 100

    // Override queue_order + bill_amounts
    const previewOv = await previewSettlement(models, 1, {
      invoice_ids: [102, 103],
      queue_order: [103, 102],
      bill_amounts: { 103: 500 },
      payments: [{ amount: 1500, method: "Cash" }],
    });
    expect(previewOv.bills.find((b) => b.invoice_id === 103).changes.payment_applied).toBe(500);
    expect(previewOv.bills.find((b) => b.invoice_id === 102).changes.payment_applied).toBe(1000);
  });

  it("4. leftover to wallet, use of wallet credit, and voiding (refuses if wallet credit spent, keeps returns)", async () => {
    const { models, state } = createStatefulHarness(build3BillSeed());
    // Customer starts with 1500 deposit_balance.
    // Pay 15000 + use_wallet_amount 1500 on bill 101 (3000) + 102 (4000) + 103 (3000) = 10000 owed -> 6500 leftover to credit!
    const payload = {
      use_wallet_amount: 1500,
      payments: [{ amount: 15000, method: "Cash" }],
      leftover_mode: "credit",
      returns: [{ equipment_id: 20, qty: 1, damaged_qty: 0 }], // +1000 late fee on 103 -> total owed 11000, leftover 5500
    };
    const preview = await previewSettlement(models, 1, payload);
    expect(preview.totals.leftover_amount).toBe(5500);

    const saved = await saveSettlement(
      models,
      1,
      { ...payload, preview_version: preview.preview_version },
      1,
    );
    expect(state.customers.get(1).deposit_balance).toBe(5500);

    // Fetch saved settlement via GET /api/settlements/:id -> matches preview to the cent
    const fetched = await getSettlementById(models, saved.settlement_id);
    expect(fetched.totals.owed_after).toBe(preview.totals.owed_after);
    expect(fetched.preview_version).toBe(preview.preview_version);

    // Simulate spending 1000 of wallet credit -> void MUST be refused with 409
    state.customers.get(1).deposit_balance = 4500;
    await expect(voidSettlement(models, saved.settlement_id, 1)).rejects.toThrow(/already been spent/i);

    // Restore wallet balance -> void succeeds, voids payments, restores wallet_used, keeps returned machines!
    state.customers.get(1).deposit_balance = 5500;
    const voided = await voidSettlement(models, saved.settlement_id, 1);
    expect(voided.is_voided).toBe(true);
    expect(voided.deposit_balance).toBe(1500); // 5500 - 5500 + 1500
    expect(state.payments.every((p) => p.is_voided === true)).toBe(true);
    expect(state.lines.get(4).line_status).toBe("Returned"); // returns NOT undone
  });

  it("5. returns 409 settlement_changed when a balance changed or a day passed", async () => {
    const { models, state } = createStatefulHarness(build3BillSeed());
    const preview = await previewSettlement(models, 1, {
      returns: [{ equipment_id: 10, qty: 5, damaged_qty: 0 }],
      payments: [{ amount: 2000, method: "Cash" }],
    });

    // Case A: Another payment arrives before save
    state.payments.push({ payment_id: 9999, invoice_id: 101, payment_amount: 500, is_voided: false });
    await expect(
      saveSettlement(models, 1, {
        returns: [{ equipment_id: 10, qty: 5, damaged_qty: 0 }],
        payments: [{ amount: 2000, method: "Cash" }],
        preview_version: preview.preview_version,
      }, 1),
    ).rejects.toBeInstanceOf(SettlementChangedError);

    // Case B: A day passes
    const preview2 = await previewSettlement(models, 1, {
      returns: [{ equipment_id: 10, qty: 5, damaged_qty: 0 }],
    });
    vi.setSystemTime(new Date("2026-11-26T12:00:00+05:30"));
    await expect(
      saveSettlement(models, 1, {
        returns: [{ equipment_id: 10, qty: 5, damaged_qty: 0 }],
        preview_version: preview2.preview_version,
      }, 1),
    ).rejects.toBeInstanceOf(SettlementChangedError);
  });

  it("6. idempotency middleware replays 2xx, returns 409 on concurrent duplicate, and releases on 409 settlement_changed", async () => {
    const { models } = createStatefulHarness(build3BillSeed());
    const mw = settlementIdempotency({
      scope: () => "POST:/api/customers/1/settlement",
      resolveModels: () => models,
    });

    const makeRes = () => {
      const r = {
        statusCode: 200,
        headersSent: false,
        body: null,
        listeners: {},
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(b) {
          this.body = b;
          return this;
        },
        on(ev, fn) {
          this.listeners[ev] = fn;
        },
      };
      return r;
    };

    const req1 = { method: "POST", get: (h) => (h === "Idempotency-Key" ? "key-abc" : null) };
    const res1 = makeRes();
    let next1Called = false;
    await mw(req1, res1, () => {
      next1Called = true;
    });
    expect(next1Called).toBe(true);

    // Concurrent duplicate while key-abc is still 'processing' -> 409
    const reqConcurrent = { method: "POST", get: (h) => (h === "Idempotency-Key" ? "key-abc" : null) };
    const resConcurrent = makeRes();
    await mw(reqConcurrent, resConcurrent, () => {});
    expect(resConcurrent.statusCode).toBe(409);

    // First request finishes with 201
    res1.status(201).json({ status: "success", data: { settlement_id: 100 } });
    await Promise.resolve();
    await Promise.resolve();

    // Retry with same key -> replays 201 without calling next()
    const reqRetry = { method: "POST", get: (h) => (h === "Idempotency-Key" ? "key-abc" : null) };
    const resRetry = makeRes();
    let retryNext = false;
    await mw(reqRetry, resRetry, () => {
      retryNext = true;
    });
    expect(retryNext).toBe(false);
    expect(resRetry.statusCode).toBe(201);
    expect(resRetry.body.data.settlement_id).toBe(100);
  });

  it("7. enforces 200 bills and 500 lines limits, and complete-bills closes paid-off fully-back bills", async () => {
    const bills = Array.from({ length: 201 }, (_, i) => ({
      invoice_id: i + 1,
      customer_id: 1,
      issued_date: "2026-11-20T09:00:00Z",
      status: "PendingPayment",
      total_amount: 100,
      sub_total: 100,
      accrued_charges: 0,
      accrued_rental: 0,
      discount_amount: 0,
      transport_fee: 0,
      id_card_status: 0,
      is_deleted: false,
    }));
    const { models: mLimit } = createStatefulHarness({
      customers: build3BillSeed().customers,
      invoices: bills,
    });
    await expect(previewSettlement(mLimit, 1, {})).rejects.toThrow(/at most 200 bills/i);

    // complete-bills
    const seed = build3BillSeed();
    seed.invoices[0].status = "PendingPayment";
    seed.invoices[0].total_amount = 1000;
    seed.lines[0].good_returned_qty = 15;
    seed.lines[0].line_status = "Returned";
    seed.payments.push({ payment_id: 1, invoice_id: 101, payment_amount: 1000, is_voided: false });

    const { models: mComp, state: sComp } = createStatefulHarness(seed);
    const res = await completeSettlementBills(
      mComp,
      1,
      { invoice_ids: [101], release_id_card: true },
      1,
    );
    expect(res.completed_invoice_ids).toEqual([101]);
    expect(sComp.invoices.get(101).status).toBe("Completed");
    expect(sComp.customers.get(1).is_id_retained_currently).toBe(false);
  });

  it("8. getCustomerOpenBills pages 30 bills at a time fast even with 2,000 bills", async () => {
    const pageRows = Array.from({ length: 30 }, (_, i) => ({
      invoice_id: i + 1,
      issued_date: "2026-11-20T09:00:00Z",
      status: "Active",
      billed_total_amount: 1000,
      accrued_charges: 0,
      discount_amount: 0,
      transport_fee: 0,
      id_card_status: 0,
      borrowed_on_behalf_of_customer_id: null,
      live_total: 1000,
      amount_paid: 0,
      owed: 1000,
    }));
    const mockModels = {
      sequelize: {
        query: vi
          .fn()
          .mockResolvedValueOnce([{ total: 2000 }])
          .mockResolvedValueOnce(pageRows)
          .mockResolvedValueOnce([]),
      },
    };
    const t0 = performance.now();
    const res = await getCustomerOpenBills(mockModels, 1, { page: 1, limit: 30 });
    const elapsed = performance.now() - t0;
    expect(res.total).toBe(2000);
    expect(res.bills.length).toBe(30);
    expect(res.total_pages).toBe(67);
    expect(elapsed).toBeLessThan(100);
  });
});
