import { Sequelize } from "sequelize";
import { describe, expect, it, vi } from "vitest";
import CallNoteModel from "../../src/models/CallNote.js";
import {
  getDeviceCallCard,
  listDeviceCallsToNote,
  saveDeviceCallNote,
} from "../../src/services/callLogService.js";
import { listActivity, maskAmounts } from "../../src/services/activityService.js";
import { PostDeviceCallNoteContract } from "@geargrid/contracts";

// The real model rules, so a value the column would refuse fails here too.
const RealCallNote = CallNoteModel(new Sequelize({ dialect: "mysql", logging: false }));

const callRow = (over = {}) => {
  const row = {
    call_id: 7,
    operator_device_id: 3,
    client_call_id: "c-7",
    direction: "OUTGOING",
    customer_id: 11,
    contact_id: null,
    invoice_ids: [101],
    started_at: new Date("2026-11-25T04:00:00Z"),
    ended_at: new Date("2026-11-25T04:01:20Z"),
    duration_seconds: 80,
    Customer: { first_name: "Saman", last_name: "Perera" },
    CallNotes: [],
    ...over,
  };
  row.update = vi.fn(async (patch) => Object.assign(row, patch));
  return row;
};

const sequelizeWithBills = (rows) => ({
  constructor: { QueryTypes: { SELECT: "SELECT" } },
  query: vi.fn(async () => rows),
});

const cashier = (permissions = ["calls:view"]) => ({
  findByPk: vi.fn(async () => ({
    user_id: 5,
    is_active: true,
    Roles: [{ role_id: 2, role_name: "Cashier", is_active: true, Permissions: permissions.map((permission_code) => ({ permission_code })) }],
  })),
});

const openBills = [
  { invoice_id: 101, owed: "5000.004", units_out: 0 },
  { invoice_id: 102, owed: "0", units_out: "3" },
  { invoice_id: 103, owed: "0", units_out: 0 },
];

const cardModels = ({ row = callRow(), activityRoles } = {}) => ({
  CallLog: { findOne: vi.fn(async () => row) },
  User: cashier(),
  TenantConfig: { findOne: vi.fn(async () => ({ custom_settings: activityRoles ? { activity_roles: activityRoles } : {} })) },
  sequelize: sequelizeWithBills(openBills),
});

describe("phone call card (M2)", () => {
  it("returns the suggested outcome and the open bills, ticking the linked ones", async () => {
    const models = cardModels();
    const card = await getDeviceCallCard(models, { operator_device_id: 3, user_id: 5 }, "c-7");

    expect(models.CallLog.findOne.mock.calls[0][0].where).toEqual({ client_call_id: "c-7", operator_device_id: 3 });
    expect(card.call.suggested_outcome).toBe("answered");
    expect(card.call.customer_name).toBe("Saman Perera");
    expect(card.bills).toEqual([
      { invoice_id: 101, units_out: 0, owed: 5000, selected: true },
      { invoice_id: 102, units_out: 3, owed: 0, selected: false },
    ]);
    expect(card.call_results.map((r) => r.key)).toContain("will_pay_on_date");
    expect(card.note).toBeNull();
  });

  it("hides amounts from a role that may not see them", async () => {
    const models = cardModels({ activityRoles: { 2: { types: ["payment"], see_amounts: false } } });
    const card = await getDeviceCallCard(models, { operator_device_id: 3, user_id: 5 }, "c-7");
    expect(card.see_amounts).toBe(false);
    expect(card.bills.every((b) => b.owed === null)).toBe(true);
  });

  it("answers 404 for a call made on another phone", async () => {
    const models = cardModels({ row: null });
    await expect(getDeviceCallCard(models, { operator_device_id: 9, user_id: 5 }, "c-7")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("lists only unnoted calls of customers with open bills", async () => {
    const rows = [
      callRow(),
      callRow({ call_id: 8, client_call_id: "c-8", CallNotes: [{ note_id: 1 }] }),
      callRow({ call_id: 9, client_call_id: "c-9", customer_id: 12 }),
    ];
    const query = vi.fn(async (_sql, opts) => (opts.replacements.customerId === 11 ? openBills : []));
    const models = {
      CallLog: { findAll: vi.fn(async () => rows) },
      TenantConfig: { findOne: vi.fn(async () => null) },
      sequelize: { ...sequelizeWithBills([]), query },
    };
    const res = await listDeviceCallsToNote(models, { operator_device_id: 3 }, { now: new Date("2026-11-25T06:00:00Z") });
    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ client_call_id: "c-7", open_bills: 2, customer_name: "Saman Perera" });
    expect(models.CallLog.findAll.mock.calls[0][0].where.operator_device_id).toBe(3);
  });
});

describe("phone call note (M2)", () => {
  const noteModels = (row) => ({
    CallLog: { findOne: vi.fn(async () => row) },
    CallNote: {
      create: vi.fn(async (values) => {
        await RealCallNote.build(values).validate();
        return { ...values, note_id: 1, created_at: new Date() };
      }),
    },
  });

  it("keeps the outcome and promise through the route's body check", async () => {
    const body = {
      outcome: "answered",
      result: "will_pay_on_date",
      promise_amount: 5000,
      promise_date: "2026-11-28",
      invoice_ids: [102],
    };
    const parsed = PostDeviceCallNoteContract.body.passthrough().parse(body);
    expect(parsed).toMatchObject(body);

    const row = callRow();
    const models = noteModels(row);
    const { note } = await saveDeviceCallNote(models, { user_id: 5 }, "c-7", parsed);
    expect(note).toMatchObject({ outcome: "answered", promise_amount: 5000, promise_status: "waiting", invoice_ids: [102] });
    expect(row.invoice_ids).toEqual([102]);
  });

  it("links no bill when the cashier unticks them all", async () => {
    const row = callRow();
    const models = noteModels(row);
    const { note } = await saveDeviceCallNote(models, { user_id: 5 }, "c-7", { outcome: "no_answer", invoice_ids: [] });
    expect(note.invoice_ids).toEqual([]);
    expect(row.invoice_ids).toBeNull();
  });

  it("keeps the call's bills when the caller sends no list (old app)", async () => {
    const row = callRow();
    const { note } = await saveDeviceCallNote(noteModels(row), { user_id: 5 }, "c-7", { tags: ["Booking"] });
    expect(note.invoice_ids).toEqual([101]);
    expect(row.update).not.toHaveBeenCalled();
  });
});

describe("activity amounts and search (M2)", () => {
  it("masks money inside a sentence", () => {
    expect(maskAmounts("Payment Rs 5,000.50 · INV-3")).toBe("Payment Rs ••• · INV-3");
  });

  const activityModels = (custom) => ({
    TenantConfig: { findOne: vi.fn(async () => ({ custom_settings: custom })) },
    User: cashier(["activity:view"]),
    Customer: { findAll: vi.fn(async () => []) },
    ActivityEvent: {
      findAndCountAll: vi.fn(async () => ({
        count: 1,
        rows: [
          {
            event_id: 1,
            type: "payment",
            risk: "normal",
            amount: "5000",
            data: { sentence: { en: "Payment Rs 5,000", si: "ගෙවීම Rs 5,000" } },
          },
        ],
      })),
    },
  });

  it("never sends an amount to a role without it, not even in the sentence", async () => {
    const models = activityModels({ activity_roles: { 2: { types: ["payment"], see_amounts: false } } });
    const res = await listActivity(models, {}, { userId: 5 });
    expect(res.events[0].amount).toBeNull();
    expect(JSON.stringify(res.events[0])).not.toContain("5,000");
  });

  it("filters by customer text, and finds nothing when nobody matches", async () => {
    const models = activityModels({});
    await listActivity(models, { customer: "Perera" }, { userId: 5 });
    expect(models.Customer.findAll).toHaveBeenCalled();
    const { where } = models.ActivityEvent.findAndCountAll.mock.calls[0][0];
    expect(Object.getOwnPropertySymbols(where.customer_id).map((s) => where.customer_id[s])).toEqual([[-1]]);
  });
});
