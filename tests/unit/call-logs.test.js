import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PostDeviceCallContract,
  GetCallByIdContract,
  ListCallsContract,
} from "@geargrid/contracts";

const mockEmitToTenant = vi.fn();
const mockFindCustomerIdsByPhone = vi.fn();
const mockBuildBriefs = vi.fn();

vi.mock("../../src/sockets/emitters.js", () => ({
  emitToTenant: (...args) => mockEmitToTenant(...args),
}));

vi.mock("../../src/services/customerPhoneService.js", () => ({
  findCustomerIdsByPhone: (...args) => mockFindCustomerIdsByPhone(...args),
}));

vi.mock("../../src/services/customerBriefService.js", () => ({
  buildBriefs: (...args) => mockBuildBriefs(...args),
}));

const { recordDeviceCall, getCallById, listCalls } = await import(
  "../../src/services/callLogService.js"
);

const sampleBrief = (customerId = 41) => ({
  customer_id: customerId,
  display_name: "Kamal Perera",
  company_name: "Kamal Builders",
  parent_company: null,
  phones: ["94771234567"],
  rating: 4,
  status: "Active",
  balance_due: 12500,
  deposit_balance: 5000,
  id_retained: false,
  active_items: [],
  invoice_count: 1,
  first_rental: "2025-01-10",
  last_rental: "2026-11-10",
  last_payment: null,
  last_review_comment: null,
  summary_line: "Rs. 12,500 due · 1 open bill",
  updated_at: "2026-11-15T10:00:00.000Z",
});

describe("callLogService (D1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindCustomerIdsByPhone.mockResolvedValue([]);
    mockBuildBriefs.mockResolvedValue([]);
  });

  it("creates a RINGING call resolved to customer, emits call:incoming without PII, and upserts ENDED idempotently", async () => {
    const now = new Date("2026-11-15T10:01:00.000Z");
    const startedIso = "2026-11-15T10:00:30.000Z";
    const endedIso = "2026-11-15T10:02:00.000Z";

    mockFindCustomerIdsByPhone.mockResolvedValue([41]);

    const storedRows = new Map();
    const wrapRow = (data) => ({
      ...data,
      update: vi.fn(async (patch) => {
        Object.assign(data, patch);
        return wrapRow(data);
      }),
    });

    const models = {
      Customer: {
        findOne: vi.fn().mockResolvedValue({ customer_id: 41 }),
      },
      PhoneContact: {
        findOne: vi.fn().mockResolvedValue(null),
      },
      CallLog: {
        findOne: vi.fn(async ({ where }) => {
          const found = storedRows.get(where.client_call_id);
          return found ? wrapRow(found) : null;
        }),
        create: vi.fn(async (payload) => {
          const rec = { call_id: 101, ...payload };
          storedRows.set(payload.client_call_id, rec);
          return wrapRow(rec);
        }),
      },
    };

    const device = { operator_device_id: 7, device_label: "Shop Phone" };

    const ringingRes = await recordDeviceCall(
      models,
      "geargrid_shop_a",
      device,
      {
        client_call_id: "device-call-1",
        raw_number: "0771234567",
        direction: "INCOMING",
        state: "RINGING",
        started_at: startedIso,
      },
      { now },
    );

    expect(ringingRes).toEqual({
      call_id: 101,
      client_call_id: "device-call-1",
      customer_id: 41,
      contact_id: null,
      emitted: true,
    });
    expect(
      PostDeviceCallContract.response.safeParse({ status: "success", data: ringingRes }).success,
    ).toBe(true);
    expect(mockEmitToTenant).toHaveBeenCalledTimes(1);
    expect(mockEmitToTenant).toHaveBeenCalledWith("geargrid_shop_a", "call:incoming", {
      call_id: 101,
      started_at: startedIso,
    });

    // Follow-up ENDED event with same client_call_id updates row and emits call:ended
    const endedRes = await recordDeviceCall(
      models,
      "geargrid_shop_a",
      device,
      {
        client_call_id: "device-call-1",
        raw_number: "0771234567",
        direction: "INCOMING",
        state: "ENDED",
        started_at: startedIso,
        ended_at: endedIso,
        duration_seconds: 90,
      },
      { now: new Date("2026-11-15T10:02:05.000Z") },
    );

    expect(endedRes.emitted).toBe(true);
    expect(mockEmitToTenant).toHaveBeenLastCalledWith("geargrid_shop_a", "call:ended", {
      call_id: 101,
      duration_seconds: 90,
    });
    expect(storedRows.get("device-call-1").duration_seconds).toBe(90);

    // Out-of-order late RINGING replay must NOT wipe ended_at or re-emit call:incoming
    mockEmitToTenant.mockClear();
    const lateRinging = await recordDeviceCall(
      models,
      "geargrid_shop_a",
      device,
      {
        client_call_id: "device-call-1",
        raw_number: "0771234567",
        direction: "INCOMING",
        state: "RINGING",
        started_at: startedIso,
      },
      { now: new Date("2026-11-15T10:02:10.000Z") },
    );
    expect(lateRinging.emitted).toBe(false);
    expect(mockEmitToTenant).not.toHaveBeenCalled();
    expect(storedRows.get("device-call-1").ended_at).toBeTruthy();
  });

  it("suppresses Socket.IO emission for stale outbox events older than 2 minutes", async () => {
    const now = new Date("2026-11-15T10:05:00.000Z");
    const staleStart = "2026-11-15T10:02:30.000Z"; // 2m30s old

    const models = {
      Customer: { findOne: vi.fn().mockResolvedValue(null) },
      PhoneContact: { findOne: vi.fn().mockResolvedValue({ contact_id: 88 }) },
      CallLog: {
        findOne: vi.fn().mockResolvedValue(null),
        create: vi.fn(async (payload) => ({ call_id: 205, ...payload })),
      },
    };

    const res = await recordDeviceCall(
      models,
      "geargrid_shop_a",
      { operator_device_id: 3 },
      {
        client_call_id: "stale-call-1",
        raw_number: "0779998888",
        direction: "MISSED",
        state: "ENDED",
        started_at: staleStart,
        ended_at: "2026-11-15T10:02:45.000Z",
        duration_seconds: 0,
      },
      { now },
    );

    expect(res).toEqual({
      call_id: 205,
      client_call_id: "stale-call-1",
      customer_id: null,
      contact_id: 88,
      emitted: false,
    });
    expect(mockEmitToTenant).not.toHaveBeenCalled();
  });

  it("getCallById returns customer brief, contact match, none, or 404", async () => {
    mockBuildBriefs.mockResolvedValue([sampleBrief(41)]);
    const baseRow = {
      call_id: 101,
      operator_device_id: 7,
      client_call_id: "c-101",
      phone_e164: "94771234567",
      raw_number: "0771234567",
      direction: "INCOMING",
      customer_id: 41,
      contact_id: null,
      started_at: new Date("2026-11-15T10:00:00Z"),
      ended_at: null,
      duration_seconds: null,
      OperatorDevice: { device_label: "Front Desk" },
    };

    const models = {
      OperatorDevice: {},
      Customer: {},
      PhoneContact: {
        findByPk: vi.fn().mockResolvedValue({
          contact_id: 88,
          display_name: "Hardware Sunimal",
          phone_e164: "94775554444",
          linked_customer_id: null,
          OperatorDevice: { device_label: "Boss Phone" },
        }),
        findOne: vi.fn().mockResolvedValue(null),
      },
      CallLog: {
        findByPk: vi
          .fn()
          .mockResolvedValueOnce(baseRow)
          .mockResolvedValueOnce({
            ...baseRow,
            call_id: 102,
            customer_id: null,
            contact_id: 88,
            phone_e164: "94775554444",
          })
          .mockResolvedValueOnce({
            ...baseRow,
            call_id: 103,
            customer_id: null,
            contact_id: null,
            phone_e164: "94710000000",
          })
          .mockResolvedValueOnce(null),
      },
    };

    const customerRes = await getCallById(models, 101);
    expect(customerRes.match).toBe("customer");
    expect(customerRes.brief?.customer_id).toBe(41);
    expect(customerRes.call.device_label).toBe("Front Desk");
    expect(
      GetCallByIdContract.response.safeParse({ status: "success", data: customerRes }).success,
    ).toBe(true);

    const contactRes = await getCallById(models, 102);
    expect(contactRes.match).toBe("contact");
    expect(contactRes.contact?.display_name).toBe("Hardware Sunimal");
    expect(
      GetCallByIdContract.response.safeParse({ status: "success", data: contactRes }).success,
    ).toBe(true);

    const noneRes = await getCallById(models, 103);
    expect(noneRes.match).toBe("none");
    expect(noneRes.brief).toBeNull();
    expect(noneRes.contact).toBeNull();
    expect(
      GetCallByIdContract.response.safeParse({ status: "success", data: noneRes }).success,
    ).toBe(true);

    await expect(getCallById(models, 999)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("listCalls filters by customer_id, uses distinct call_id count, and satisfies ListCallsContract", async () => {
    const findAndCountAll = vi.fn().mockResolvedValue({
      count: 1,
      rows: [
        {
          call_id: 101,
          operator_device_id: 7,
          client_call_id: "c-101",
          phone_e164: "94771234567",
          raw_number: "0771234567",
          direction: "OUTGOING",
          customer_id: 41,
          contact_id: null,
          started_at: new Date("2026-11-15T10:00:00Z"),
          ended_at: new Date("2026-11-15T10:01:15Z"),
          duration_seconds: 75,
          OperatorDevice: { device_label: "Front Desk" },
          Customer: { first_name: "Kamal", last_name: "Perera", company_name: null },
          PhoneContact: null,
        },
      ],
    });

    const res = await listCalls(
      {
        CallLog: { findAndCountAll },
        OperatorDevice: {},
        Customer: {},
        PhoneContact: {},
      },
      { customer_id: 41, page: 1, limit: 20 },
    );

    expect(findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customer_id: 41 },
        distinct: true,
        col: "call_id",
      }),
    );
    expect(res.calls).toHaveLength(1);
    expect(res.calls[0].customer_name).toBe("Kamal Perera");
    expect(res.total).toBe(1);
    expect(
      ListCallsContract.response.safeParse({ status: "success", data: res }).success,
    ).toBe(true);
  });
});
