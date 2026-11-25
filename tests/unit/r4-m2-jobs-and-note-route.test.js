import express from "express";
import request from "supertest";
import { Op, Sequelize } from "sequelize";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CallNoteModel from "../../src/models/CallNote.js";
import ActivityEventModel from "../../src/models/ActivityEvent.js";

const state = vi.hoisted(() => ({ models: {}, scheduled: [], notify: [] }));

vi.mock("node-cron", () => ({
  default: { schedule: (...args) => state.scheduled.push(args) },
}));
vi.mock("../../src/middlewares/authMiddleware.js", () => ({
  protect: (req, _res, next) => {
    req.user = { tenantDbName: "shop", userId: 7 };
    req.tenantModels = state.models;
    next();
  },
  requirePermission: () => (_req, _res, next) => next(),
}));
vi.mock("../../src/middlewares/planMiddleware.js", () => ({
  requireFeature: () => (_req, _res, next) => next(),
}));
vi.mock("../../src/services/pushEventService.js", async (importOriginal) => ({
  ...(await importOriginal()),
  notifyEvent: vi.fn(async (_models, key) => {
    state.notify.push(key);
    return { sent: 0 };
  }),
}));

const { default: errorHandler } = await import("../../src/middlewares/errorHandler.js");
const { default: callRoutes } = await import("../../src/routes/callRoutes.js");
const { default: setupCronJobs } = await import("../../src/utils/cronJobs.js");
const { runFollowUpJob, runCallRetentionJob } = await import("../../src/services/scheduledJobs.js");
const { sendDueFollowUpPushes, purgeExpiredCallLogs } = await import("../../src/services/callLogService.js");
const { listActivity } = await import("../../src/services/activityService.js");

const dummy = new Sequelize({ dialect: "mysql", logging: false });
const RealCallNote = CallNoteModel(dummy);
const RealActivityEvent = ActivityEventModel(dummy);

describe("staff call note route (the path the web card posts to)", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/calls", callRoutes);
  app.use(errorHandler);

  let callRow;
  beforeEach(() => {
    callRow = { call_id: 55, customer_id: 11, contact_id: null, invoice_ids: [101] };
    callRow.update = vi.fn(async (patch) => Object.assign(callRow, patch));
    state.models = {
      CallLog: { findByPk: vi.fn(async () => callRow) },
      CallNote: {
        create: vi.fn(async (values) => {
          await RealCallNote.build(values).validate();
          return { ...values, note_id: 1, created_at: new Date() };
        }),
      },
    };
  });

  it("POST /api/calls/:id/note saves outcome, result, promise, follow-up and bills", async () => {
    const body = {
      outcome: "answered",
      result: "will_pay_on_date",
      promise_amount: 5000,
      promise_date: "2026-11-30",
      follow_up_on: "2026-11-30",
      invoice_ids: [102],
    };
    const res = await request(app).post("/api/calls/55/note").send(body);
    expect(res.status).toBe(200);
    expect(res.body.data.note).toMatchObject({ ...body, promise_status: "waiting", created_by_user_id: 7 });
  });

  it("refuses a promise result without an amount and date", async () => {
    const res = await request(app).post("/api/calls/55/note").send({ outcome: "answered", result: "will_pay_on_date" });
    expect(res.status).toBe(400);
    expect(state.models.CallNote.create).not.toHaveBeenCalled();
  });
});

describe("scheduled call jobs", () => {
  it("are registered with cron in the shop's time zone", () => {
    state.scheduled.length = 0;
    setupCronJobs();
    const timed = state.scheduled.filter(([, , options]) => options?.timezone === "Asia/Colombo");
    expect(timed.map(([when]) => when)).toEqual(["0 9 * * *", "30 2 * * *"]);
  });

  const tenants = [
    { db_name: "a", subscription_status: "Active" },
    { db_name: "b", subscription_status: "Suspended" },
    { db_name: "c", subscription_status: "Active" },
  ];

  it("run follow-ups for active shops only, carrying on past a broken one", async () => {
    const opened = [];
    const results = await runFollowUpJob({
      list: async () => tenants,
      open: async (t) => {
        opened.push(t.db_name);
        if (t.db_name === "a") throw new Error("no database");
        return { CallNote: { findAll: vi.fn(async () => []) } };
      },
    });
    expect(opened).toEqual(["a", "c"]);
    expect(results.map((r) => r.ok)).toEqual([false, true]);
  });

  it("clean up calls in every shop, suspended ones too", async () => {
    const destroy = vi.fn(async () => 2);
    const results = await runCallRetentionJob({
      list: async () => tenants,
      open: async () => ({ CallLog: { destroy } }),
    });
    expect(results).toHaveLength(3);
    expect(destroy).toHaveBeenCalledTimes(3);
  });

  it("delete nothing when the dispute holds can't be read", async () => {
    const destroy = vi.fn();
    await expect(
      purgeExpiredCallLogs({
        CallRecording: { findAll: vi.fn(async () => { throw new Error("db down"); }), destroy },
        CallLog: { destroy },
      }),
    ).rejects.toThrow("db down");
    expect(destroy).not.toHaveBeenCalled();
  });
});

describe("Call again today", () => {
  const now = new Date("2026-11-25T03:30:00Z");
  const note = (over) => ({
    note_id: 9,
    call_id: 55,
    customer_id: 11,
    invoice_ids: [101],
    note: "Pays Friday",
    follow_up_on: "2026-11-25",
    ...over,
  });

  const feedModels = (notes, events = []) => ({
    CallNote: { findAll: vi.fn(async () => notes) },
    ActivityEvent: {
      findAll: vi.fn(async () => events),
      create: vi.fn(async (values) => {
        await RealActivityEvent.build(values).validate();
        events.push(values);
        return { ...values, event_id: events.length };
      }),
    },
  });

  it("adds one feed event per note due today, however often the job runs", async () => {
    const models = feedModels([note(), note({ note_id: 10, follow_up_on: "2026-11-23" })]);
    await sendDueFollowUpPushes(models, "shop", { now });
    await sendDueFollowUpPushes(models, "shop", { now });
    expect(models.ActivityEvent.create).toHaveBeenCalledTimes(1);
    expect(models.ActivityEvent.create.mock.calls[0][0]).toMatchObject({
      type: "system",
      invoice_id: 101,
      data: { kind: "call_again_today", note_id: 9, sentence: { en: expect.stringContaining("Call again today") } },
    });
  });

  it("stops reminding about follow-ups older than a week", async () => {
    const models = feedModels([]);
    await sendDueFollowUpPushes(models, "shop", { now });
    expect(models.CallNote.findAll.mock.calls[0][0].where.follow_up_on[Op.between]).toEqual(["2026-11-18", "2026-11-25"]);
  });
});

describe("bill activity history", () => {
  const run = async (query) => {
    const findAndCountAll = vi.fn(async () => ({ count: 0, rows: [] }));
    await listActivity(
      { TenantConfig: { findOne: vi.fn(async () => null) }, ActivityEvent: { findAndCountAll } },
      query,
    );
    return findAndCountAll.mock.calls[0][0].where;
  };

  it("returns only that bill's events", async () => {
    expect((await run({ invoice_id: "345" })).invoice_id).toBe(345);
  });

  it("returns nothing for a bad id or a bill search for another bill", async () => {
    expect((await run({ invoice_id: "abc" })).invoice_id).toBe(-1);
    expect((await run({ invoice_id: "345", invoice: "INV-9" })).invoice_id).toBe(-1);
  });
});
