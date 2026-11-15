import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreateCallNoteBodySchema,
  GetDevicePolicyContract,
  ListCallsContract,
  ListDeviceFollowUpsContract,
  ListDeviceMissedCallsContract,
  ListFollowUpsContract,
  ListMissedCallsContract,
  MarkCallHandledContract,
  PostDeviceCallNoteContract,
  PostStaffCallNoteContract,
  UpdateFollowUpContract,
} from "@geargrid/contracts";

const state = vi.hoisted(() => ({
  tenantModels: {},
  authUser: { tenantDbName: "geargrid_shop1", userId: 7 },
  notifyCalls: [],
  emittedEvents: [],
}));

vi.mock("../../src/config/database.js", () => ({
  getCachedTenantConnection: (dbName) => ({ dbName }),
  masterSequelize: { query: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../../src/models/index.js", () => ({
  initTenantModels: () => state.tenantModels,
}));

vi.mock("../../src/middlewares/authMiddleware.js", () => ({
  protect: (req, _res, next) => {
    req.user = { ...state.authUser };
    next();
  },
  requirePermission: () => (_req, _res, next) => next(),
}));

vi.mock("../../src/middlewares/planMiddleware.js", () => ({
  requireFeature: () => (_req, _res, next) => next(),
}));

vi.mock("../../src/services/planService.js", () => ({
  getTenantPlan: async () => ({ features: { phone_assistant: true } }),
}));

vi.mock("../../src/sockets/emitters.js", () => ({
  emitToTenant: (...args) => state.emittedEvents.push(args),
}));

vi.mock("../../src/services/pushEventService.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    notifyEvent: vi.fn(async (...args) => {
      state.notifyCalls.push(args);
      return { sent: true };
    }),
  };
});

const { default: errorHandler } = await import("../../src/middlewares/errorHandler.js");
const { default: callRoutes } = await import("../../src/routes/callRoutes.js");
const { default: followUpRoutes } = await import("../../src/routes/followUpRoutes.js");
const {
  recordDeviceCall,
  saveDeviceCallNote,
  saveStaffCallNote,
  listCalls,
  listMissedCalls,
  markCallHandled,
  listFollowUps,
  updateFollowUp,
  sendDueFollowUpPushes,
} = await import("../../src/services/callLogService.js");
const { buildBriefs } = await import("../../src/services/customerBriefService.js");
const {
  getPhoneAssistantPolicy,
  updatePhoneAssistantPolicy,
} = await import("../../src/services/phoneAssistantPolicyService.js");
const { getDevicePolicy } = await import("../../src/services/deviceService.js");
const { PUSH_EVENT_KEYS } = await import("../../src/config/pushEvents.js");

const makeCustomerModels = ({ notes = [] } = {}) => {
  const customerUpdate = vi.fn().mockResolvedValue([1]);
  const createdNotes = [...notes];
  const models = {
    Customer: {
      findAll: vi.fn().mockResolvedValue([
        {
          customer_id: 41,
          first_name: "Kamal",
          last_name: "Perera",
          company_name: null,
          parent_customer_id: null,
          phone_number: "0771234567",
          rating: 4.5,
          status: "Active",
          deposit_balance: 0,
          is_id_retained_currently: false,
          brief_changed_at: new Date("2026-11-15T09:00:00Z"),
          updatedAt: new Date("2026-11-15T09:00:00Z"),
        },
      ]),
      update: customerUpdate,
    },
    CustomerPhone: { findAll: vi.fn().mockResolvedValue([]) },
    Invoice: { findAll: vi.fn().mockResolvedValue([]) },
    InvoiceReview: { findAll: vi.fn().mockResolvedValue([]) },
    CallNote: {
      findAll: vi.fn().mockResolvedValue(createdNotes),
      findByPk: vi.fn().mockImplementation(async (id) =>
        createdNotes.find((n) => Number(n.note_id) === Number(id)) || null,
      ),
      create: vi.fn().mockImplementation(async (payload) => {
        const row = {
          note_id: 500 + createdNotes.length + 1,
          ...payload,
          created_at: new Date("2026-11-15T10:30:00Z"),
          Author: { user_id: payload.created_by_user_id || 7, first_name: "Nimal", last_name: "Silva", username: "nimal" },
        };
        createdNotes.unshift(row);
        return row;
      }),
    },
    CallLog: {
      findOne: vi.fn(),
      findByPk: vi.fn(),
      findAll: vi.fn().mockResolvedValue([]),
      findAndCountAll: vi.fn().mockResolvedValue({ count: 0, rows: [] }),
      update: vi.fn().mockResolvedValue([0]),
    },
    OperatorDevice: {},
    PhoneContact: {},
    User: {},
    TenantConfig: {
      findOne: vi.fn().mockResolvedValue({
        custom_settings: { phone_assistant: {} },
        update: vi.fn(),
      }),
    },
  };
  return { models, customerUpdate, createdNotes };
};

describe("Phone Assistant Release 2 — Part D1, D2, D3, D6", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.notifyCalls = [];
    state.emittedEvents = [];
    state.tenantModels = {};
  });

  it("1. D1: saveDeviceCallNote & saveStaffCallNote save tags/note/follow_up, bump Customer.brief_changed_at, and populate recent_call_notes in briefs", async () => {
    const { models, customerUpdate } = makeCustomerModels();
    const callRow = {
      call_id: 101,
      client_call_id: "c-101",
      customer_id: 41,
      contact_id: null,
    };
    models.CallLog.findOne.mockResolvedValue(callRow);
    models.CallLog.findByPk.mockResolvedValue(callRow);

    const devRes = await saveDeviceCallNote(
      models,
      { operator_device_id: 5, user_id: 7 },
      "c-101",
      {
        tags: ["Booking", "Payment promise"],
        note: "Customer promised to settle on Friday",
        follow_up_on: "2026-11-18",
      },
    );

    expect(
      PostDeviceCallNoteContract.response.safeParse({ status: "success", data: devRes }).success,
    ).toBe(true);
    expect(devRes.note.tags).toEqual(["Booking", "Payment promise"]);
    expect(devRes.note.follow_up_on).toBe("2026-11-18");
    expect(customerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ brief_changed_at: expect.any(Date) }),
      { where: { customer_id: 41 } },
    );

    const staffRes = await saveStaffCallNote(models, 7, 101, {
      tags: ["Extension"],
      note: "Extended till Monday",
      follow_up_on: null,
    });
    expect(
      PostStaffCallNoteContract.response.safeParse({ status: "success", data: staffRes }).success,
    ).toBe(true);

    const briefs = await buildBriefs(models, [41]);
    expect(briefs).toHaveLength(1);
    expect(briefs[0].recent_call_notes).toHaveLength(2);
    expect(briefs[0].recent_call_notes[0].outcome).toContain("Extension");
    expect(briefs[0].recent_call_notes[1].outcome).toContain("Booking");
    expect(CreateCallNoteBodySchema.safeParse({ tags: ["Booking"] }).success).toBe(true);
  });

  it("2. D1: phoneAssistantPolicyService manages after_call_card defaults, validation, and /device/policy exposure", async () => {
    let storedSettings = {};
    const configRow = {
      get custom_settings() {
        return storedSettings;
      },
      update: vi.fn(async ({ custom_settings }) => {
        storedSettings = custom_settings;
      }),
    };
    const models = {
      TenantConfig: { findOne: vi.fn().mockResolvedValue(configRow) },
      OperatorDevice: {
        update: vi.fn().mockResolvedValue([0]),
        findAll: vi.fn().mockResolvedValue([]),
      },
      PhoneContact: { count: vi.fn().mockResolvedValue(0) },
      CallLog: { count: vi.fn().mockResolvedValue(0) },
      User: {
        findByPk: vi.fn().mockResolvedValue({ user_id: 1, is_active: true, Roles: [] }),
      },
      UserPermissionOverride: { findAll: vi.fn().mockResolvedValue([]) },
    };

    const initial = await getPhoneAssistantPolicy(models);
    expect(initial.policy.after_call_card).toEqual({
      enabled: true,
      tags: [
        "Booking",
        "Payment promise",
        "Extension",
        "Complaint",
        "Price enquiry",
        "Wrong number",
      ],
      auto_dismiss_seconds: 25,
    });

    await expect(
      updatePhoneAssistantPolicy(models, {
        after_call_card: { enabled: true, tags: [], auto_dismiss_seconds: 25 },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      updatePhoneAssistantPolicy(models, {
        after_call_card: { enabled: true, tags: ["VIP"], auto_dismiss_seconds: 300 },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const updated = await updatePhoneAssistantPolicy(models, {
      after_call_card: { enabled: false, tags: ["Booking", "VIP"], auto_dismiss_seconds: 15 },
    });
    expect(updated.policy.after_call_card).toEqual({
      enabled: false,
      tags: ["Booking", "VIP"],
      auto_dismiss_seconds: 15,
    });

    const devPolicy = await getDevicePolicy(models, "geargrid_shop1", {
      operator_device_id: 2,
      user_id: 1,
      status: "ACTIVE",
      capabilities: { caller_brief: true },
    });
    expect(devPolicy.after_call_card).toEqual({
      enabled: false,
      tags: ["Booking", "VIP"],
      auto_dismiss_seconds: 15,
    });
    expect(
      GetDevicePolicyContract.response.safeParse({ status: "success", data: devPolicy }).success,
    ).toBe(true);
  });

  it("3. D2: listMissedCalls, markCallHandled, and recordDeviceCall auto-clear prior missed calls on answered/outgoing call", async () => {
    const callUpdate = vi.fn().mockResolvedValue([1]);
    const missedRow = {
      call_id: 201,
      operator_device_id: 3,
      client_call_id: "m-201",
      phone_e164: "94771234567",
      raw_number: "0771234567",
      direction: "MISSED",
      customer_id: 41,
      contact_id: null,
      started_at: new Date("2026-11-15T09:10:00Z"),
      ended_at: new Date("2026-11-15T09:10:25Z"),
      duration_seconds: 0,
      callback_handled_at: null,
      OperatorDevice: { operator_device_id: 3, device_label: "Front Desk" },
      Customer: { customer_id: 41, first_name: "Kamal", last_name: "Perera", company_name: null },
      PhoneContact: null,
      CallNotes: [],
      update: vi.fn(async (patch) => {
        Object.assign(missedRow, patch);
        return missedRow;
      }),
    };

    const { models } = makeCustomerModels();
    models.CallLog = {
      findAll: vi.fn().mockResolvedValue([missedRow]),
      findByPk: vi.fn().mockResolvedValue(missedRow),
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        call_id: 202,
        operator_device_id: 3,
        client_call_id: "c-202",
        customer_id: 41,
        contact_id: null,
        started_at: new Date("2026-11-15T09:20:00Z"),
      }),
      update: callUpdate,
    };
    models.CustomerPhone = {
      findAll: vi.fn().mockResolvedValue([{ customer_id: 41, phone_e164: "94771234567", is_primary: true }]),
    };
    models.Customer.findOne = vi.fn().mockResolvedValue({ customer_id: 41 });

    const queue = await listMissedCalls(models);
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0].customer_name).toBe("Kamal Perera");
    expect(queue.items[0].brief?.customer_id).toBe(41);
    expect(
      ListMissedCallsContract.response.safeParse({ status: "success", data: queue }).success,
    ).toBe(true);
    expect(
      ListDeviceMissedCallsContract.response.safeParse({ status: "success", data: queue }).success,
    ).toBe(true);

    const handled = await markCallHandled(models, 201, { now: new Date("2026-11-15T09:15:00Z") });
    expect(handled.call_id).toBe(201);
    expect(missedRow.callback_handled_at).toEqual(new Date("2026-11-15T09:15:00Z"));
    expect(
      MarkCallHandledContract.response.safeParse({ status: "success", data: handled }).success,
    ).toBe(true);

    callUpdate.mockClear();
    await recordDeviceCall(
      models,
      "geargrid_shop1",
      { operator_device_id: 3, call_logging_scope: "customers_and_contacts" },
      {
        client_call_id: "c-202",
        raw_number: "0771234567",
        direction: "OUTGOING",
        state: "ENDED",
        started_at: "2026-11-15T09:20:00Z",
        ended_at: "2026-11-15T09:21:00Z",
        duration_seconds: 60,
      },
      { now: new Date("2026-11-15T09:21:05Z") },
    );

    expect(callUpdate).toHaveBeenCalledWith(
      { callback_handled_at: new Date("2026-11-15T09:21:00Z") },
      {
        where: {
          direction: "MISSED",
          callback_handled_at: null,
          phone_e164: "94771234567",
        },
      },
    );
  });

  it("4. D3: listFollowUps, updateFollowUp (done/snooze), and sendDueFollowUpPushes (`follow_up_due`)", async () => {
    expect(PUSH_EVENT_KEYS).toContain("follow_up_due");

    const noteRow = {
      note_id: 301,
      call_id: 101,
      customer_id: 41,
      contact_id: null,
      tags: ["Payment promise"],
      note: "Check payment confirmation",
      follow_up_on: "2026-11-15",
      follow_up_done_at: null,
      created_by_user_id: 7,
      created_at: new Date("2026-11-15T08:00:00Z"),
      Customer: { customer_id: 41, first_name: "Kamal", last_name: "Perera", company_name: null },
      PhoneContact: null,
      CallLog: { call_id: 101, phone_e164: "94771234567", raw_number: "0771234567" },
      Author: { user_id: 7, first_name: "Nimal", last_name: "Silva", username: "nimal" },
      update: vi.fn(async (patch) => {
        Object.assign(noteRow, patch);
        return noteRow;
      }),
    };

    const { models, customerUpdate } = makeCustomerModels({ notes: [noteRow] });
    models.CallNote.findByPk.mockResolvedValue(noteRow);

    const pending = await listFollowUps(models, { status: "pending" });
    expect(pending.items).toHaveLength(1);
    expect(pending.items[0].customer_name).toBe("Kamal Perera");
    expect(
      ListFollowUpsContract.response.safeParse({ status: "success", data: pending }).success,
    ).toBe(true);
    expect(
      ListDeviceFollowUpsContract.response.safeParse({ status: "success", data: pending }).success,
    ).toBe(true);

    const pushRes = await sendDueFollowUpPushes(models, "geargrid_shop1", {
      now: new Date("2026-11-15T09:00:00Z"),
    });
    expect(pushRes.sent_count).toBe(1);
    expect(state.notifyCalls).toHaveLength(1);
    expect(state.notifyCalls[0][1]).toBe("follow_up_due");

    const doneRes = await updateFollowUp(
      models,
      301,
      { done: true },
      { now: new Date("2026-11-15T11:00:00Z") },
    );
    expect(doneRes.follow_up.follow_up_done_at).toBe("2026-11-15T11:00:00.000Z");
    expect(customerUpdate).toHaveBeenCalled();

    const snoozeRes = await updateFollowUp(models, 301, { snooze_to: "2026-11-20" });
    expect(snoozeRes.follow_up.follow_up_on).toBe("2026-11-20");
    expect(snoozeRes.follow_up.follow_up_done_at).toBeNull();
    expect(
      UpdateFollowUpContract.response.safeParse({ status: "success", data: snoozeRes }).success,
    ).toBe(true);
  });

  it("5. D6 route check: GET /api/calls/missed is not shadowed by GET /api/calls/:id and returns notes/follow-ups", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/calls", callRoutes);
    app.use("/api/follow-ups", followUpRoutes);
    app.use(errorHandler);

    const { models } = makeCustomerModels();
    models.CallLog.findAll = vi.fn().mockResolvedValue([]);
    models.CallLog.findByPk = vi.fn().mockResolvedValue({
      call_id: 101,
      operator_device_id: 7,
      client_call_id: "c-101",
      phone_e164: "94771234567",
      raw_number: "0771234567",
      direction: "INCOMING",
      customer_id: 41,
      contact_id: null,
      started_at: new Date("2026-11-15T10:00:00Z"),
      ended_at: new Date("2026-11-15T10:01:00Z"),
      duration_seconds: 60,
      OperatorDevice: { operator_device_id: 7, device_label: "Front Desk" },
      CallNotes: [
        {
          note_id: 901,
          call_id: 101,
          customer_id: 41,
          contact_id: null,
          tags: ["Booking"],
          note: "Booked compressor",
          follow_up_on: "2026-11-17",
          follow_up_done_at: null,
          created_by_user_id: 7,
          created_at: new Date("2026-11-15T10:02:00Z"),
          Author: { user_id: 7, first_name: "Nimal", last_name: "Silva", username: "nimal" },
        },
      ],
    });
    models.CallLog.findAndCountAll = vi.fn().mockResolvedValue({
      count: 1,
      rows: [
        {
          call_id: 101,
          operator_device_id: 7,
          client_call_id: "c-101",
          phone_e164: "94771234567",
          raw_number: "0771234567",
          direction: "INCOMING",
          customer_id: 41,
          contact_id: null,
          started_at: new Date("2026-11-15T10:00:00Z"),
          ended_at: new Date("2026-11-15T10:01:00Z"),
          duration_seconds: 60,
          OperatorDevice: { operator_device_id: 7, device_label: "Front Desk" },
          Customer: { customer_id: 41, first_name: "Kamal", last_name: "Perera", company_name: null },
          PhoneContact: null,
          CallNotes: [
            {
              note_id: 901,
              call_id: 101,
              customer_id: 41,
              contact_id: null,
              tags: ["Booking"],
              note: "Booked compressor",
              follow_up_on: "2026-11-17",
              follow_up_done_at: null,
              created_by_user_id: 7,
              created_at: new Date("2026-11-15T10:02:00Z"),
              Author: { user_id: 7, first_name: "Nimal", last_name: "Silva", username: "nimal" },
            },
          ],
        },
      ],
    });
    state.tenantModels = models;

    const missedRes = await request(app).get("/api/calls/missed");
    expect(missedRes.status).toBe(200);
    expect(missedRes.body.data.items).toEqual([]);

    const callsRes = await request(app).get("/api/calls?customer_id=41");
    expect(callsRes.status).toBe(200);
    expect(callsRes.body.data.calls[0].notes).toHaveLength(1);
    expect(ListCallsContract.response.safeParse(callsRes.body).success).toBe(true);

    const noteRes = await request(app)
      .post("/api/calls/101/note")
      .send({ tags: ["Booking"], note: "Follow up tomorrow", follow_up_on: "2026-11-16" });
    expect(noteRes.status).toBe(200);
    expect(noteRes.body.data.note.created_by_user_id).toBe(7);

    const followUpsRes = await request(app).get("/api/follow-ups");
    expect(followUpsRes.status).toBe(200);
    expect(ListFollowUpsContract.response.safeParse(followUpsRes.body).success).toBe(true);
  });
});
