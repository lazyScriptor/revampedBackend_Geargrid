import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import util from "util";
import { Sequelize } from "sequelize";
import { initTenantModels } from "../../src/models/index.js";
import {
  computeSuggestedOutcome,
  createManualCall,
  dialFromUserPhone,
  evaluateCallPromises,
  linkCallToCustomer,
  purgeExpiredCallLogs,
  recordDeviceCall,
} from "../../src/services/callLogService.js";
import * as activityService from "../../src/services/activityService.js";
import * as pushService from "../../src/services/devicePushService.js";
import {
  getCollectionsSettings,
  updateCollectionsSettings,
} from "../../src/services/collectionsSettingsService.js";
import {
  getCallsReport,
  getCollectionsReport,
  getCustomerCollectionsDetail,
} from "../../src/services/collectionsReportService.js";
import { getOpenInvoices } from "../../src/services/dashboardService.js";
import { findCustomerIdsBySearch } from "../../src/utils/customerSearch.js";
import { createLocalStorageDriver } from "../../src/services/storage/localDriver.js";
import { createOciStorageDriver } from "../../src/services/storage/ociDriver.js";
import {
  getCallRecordingPlayback,
  setCallRecordingDisputeHold,
  uploadDeviceCallRecording,
} from "../../src/services/callRecordingService.js";
import { getRentalTerms } from "../../src/services/signatureService.js";

// Build real Sequelize models on a dummy instance so .build().validate() enforces real ENUMs & required fields.
const dummySeq = new Sequelize("mysql://user:pass@localhost:3306/dummy", { logging: false });
const realModels = initTenantModels(dummySeq);

const assertSavable = async (Model, data) => {
  const inst = Model.build(data);
  await inst.validate();
  return inst;
};

describe("Release 4 Slice 2: Collections Backend", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("1. computes suggested_outcome from duration_seconds and answeredThresholdSeconds", () => {
    expect(computeSuggestedOutcome(5, 5)).toBe("answered");
    expect(computeSuggestedOutcome(120, 5)).toBe("answered");
    expect(computeSuggestedOutcome(4, 5)).toBe("no_answer");
    expect(computeSuggestedOutcome(0, 5)).toBe("no_answer");
    expect(computeSuggestedOutcome(null, 5)).toBeNull();
    expect(computeSuggestedOutcome(8, 10)).toBe("no_answer");
    expect(computeSuggestedOutcome(10, 10)).toBe("answered");
  });

  it("2. manual call flow creates CALL_LOGS (source=manual) + CALL_NOTES and validates real model rules", async () => {
    const createdCalls = [];
    const createdNotes = [];
    const models = {
      TenantConfig: { findOne: vi.fn().mockResolvedValue({ custom_settings: {} }) },
      Customer: {
        findByPk: vi.fn().mockResolvedValue({ customer_id: 10, phone_number: "0771234567" }),
        update: vi.fn().mockResolvedValue([1]),
      },
      CallLog: {
        create: vi.fn(async (data) => {
          await assertSavable(realModels.CallLog, data);
          const row = { call_id: 501, ...data, started_at: data.started_at || new Date() };
          createdCalls.push(row);
          return row;
        }),
      },
      CallNote: {
        create: vi.fn(async (data) => {
          await assertSavable(realModels.CallNote, data);
          const row = {
            note_id: 901,
            ...data,
            created_at: new Date(),
            update: vi.fn(async (p) => Object.assign(row, p)),
          };
          createdNotes.push(row);
          return row;
        }),
        findByPk: vi.fn(async () => createdNotes[0]),
      },
      sequelize: {
        constructor: { QueryTypes: { SELECT: "SELECT" } },
        query: vi.fn().mockResolvedValue([{ invoice_id: 42, owed: 5000, units_out: 1 }]),
      },
    };

    // 'other' requires a note
    await expect(
      createManualCall(models, 7, {
        customer_id: 10,
        outcome: "answered",
        result: "other",
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "note_required" });

    // 'will_pay_on_date' requires promise_amount and promise_date
    await expect(
      createManualCall(models, 7, {
        customer_id: 10,
        outcome: "answered",
        result: "will_pay_on_date",
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "promise_required" });

    const res = await createManualCall(models, 7, {
      customer_id: 10,
      outcome: "answered",
      result: "will_pay_on_date",
      promise_amount: 5000,
      promise_date: "2026-12-01",
      note: "Promised Friday",
    });

    expect(createdCalls).toHaveLength(1);
    expect(createdCalls[0].source).toBe("manual");
    expect(createdCalls[0].operator_device_id).toBeNull();
    expect(createdCalls[0].user_id).toBe(7);
    expect(createdCalls[0].invoice_ids).toEqual([42]);

    expect(createdNotes).toHaveLength(1);
    expect(createdNotes[0].call_id).toBe(501);
    expect(createdNotes[0].outcome).toBe("answered");
    expect(createdNotes[0].promise_status).toBe("waiting");
    expect(res.note.promise_amount).toBe(5000);
    expect(res.call.source).toBe("manual");
  });

  it("3. evaluateCallPromises marks kept or missed and records call_promise_missed activity", async () => {
    const spyActivity = vi.spyOn(activityService, "recordActivity").mockResolvedValue(null);

    const keptNote = {
      note_id: 1,
      call_id: 11,
      customer_id: 100,
      created_by_user_id: 5,
      promise_amount: 5000,
      promise_date: "2026-11-30",
      promise_status: "waiting",
      invoice_ids: [201],
      created_at: new Date("2026-11-20T10:00:00Z"),
      update: vi.fn(async (p) => Object.assign(keptNote, p)),
    };
    const missedNote = {
      note_id: 2,
      call_id: 12,
      customer_id: 101,
      created_by_user_id: 6,
      promise_amount: 3000,
      promise_date: "2026-11-22",
      promise_status: "waiting",
      invoice_ids: [202],
      created_at: new Date("2026-11-18T10:00:00Z"),
      update: vi.fn(async (p) => Object.assign(missedNote, p)),
    };

    const models = {
      CallNote: {
        findAll: vi.fn().mockResolvedValue([keptNote, missedNote]),
      },
      Customer: { update: vi.fn().mockResolvedValue([1]) },
      sequelize: {
        constructor: { QueryTypes: { SELECT: "SELECT" } },
        query: vi.fn(async (_sql, { replacements }) => {
          if (replacements.customerId === 100) return [{ total_paid: 5000 }];
          return [{ total_paid: 500 }];
        }),
      },
    };

    const result = await evaluateCallPromises(models, "tenant_db", {
      now: new Date("2026-11-25T12:00:00Z"),
    });

    expect(result).toEqual({ kept: 1, missed: 1 });
    expect(keptNote.promise_status).toBe("kept");
    expect(keptNote.promise_kept_at).toBeInstanceOf(Date);
    expect(missedNote.promise_status).toBe("missed");
    expect(spyActivity).toHaveBeenCalledTimes(1);
    expect(spyActivity).toHaveBeenCalledWith(
      models,
      expect.objectContaining({
        type: "call_promise_missed",
        customer_id: 101,
        invoice_id: 202,
        amount: 3000,
      }),
      {},
    );
  });

  it("4. web-dial + phone record merge into one call and auto-link open bills when none provided", async () => {
    vi.spyOn(pushService, "sendDataPush").mockResolvedValue({ sent: true });
    const callStore = [];

    const makeRow = (data) => {
      const row = {
        call_id: callStore.length + 1,
        ...data,
        update: vi.fn(async (patch) => {
          Object.assign(row, patch);
          return row;
        }),
      };
      callStore.push(row);
      return row;
    };

    const models = {
      TenantConfig: { findOne: vi.fn().mockResolvedValue({ custom_settings: {} }) },
      OperatorDevice: {
        findAll: vi.fn().mockResolvedValue([
          {
            operator_device_id: 3,
            user_id: 9,
            status: "ACTIVE",
            revoked_at: null,
            push_token: "tok",
            capabilities: { click_to_call: true, call_logging: true },
          },
        ]),
      },
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 9,
          is_active: true,
          Roles: [{ role_name: "Administrator", hierarchy_level: 100, is_active: true, Permissions: [] }],
        }),
      },
      CustomerPhone: {
        findAll: vi.fn().mockResolvedValue([{ customer_id: 55 }]),
      },
      Customer: {
        findOne: vi.fn().mockResolvedValue({ customer_id: 55 }),
      },
      CallLog: {
        findOne: vi.fn(async ({ where }) => {
          if (where.client_call_id && typeof where.client_call_id === "string") {
            return callStore.find((c) => c.client_call_id === where.client_call_id) || null;
          }
          // Merge lookup by phone_e164 + dial- prefix
          return (
            callStore.find(
              (c) =>
                c.phone_e164 === where.phone_e164 &&
                c.direction === "OUTGOING" &&
                String(c.client_call_id).startsWith("dial-"),
            ) || null
          );
        }),
        create: vi.fn(async (data) => {
          await assertSavable(realModels.CallLog, data);
          return makeRow(data);
        }),
        update: vi.fn().mockResolvedValue([0]),
      },
      sequelize: {
        constructor: { QueryTypes: { SELECT: "SELECT" } },
        query: vi.fn().mockResolvedValue([{ invoice_id: 88, owed: 2500, units_out: 0 }]),
      },
    };

    const now = new Date("2026-11-25T10:00:00Z");
    const dialRes = await dialFromUserPhone(
      models,
      "tenant_db",
      9,
      { phone: "0771234567", customer_id: 55, invoice_ids: [88] },
      { now },
    );
    expect(dialRes.sent).toBe(1);
    expect(dialRes.invoice_ids).toEqual([88]);
    expect(callStore).toHaveLength(1);

    // Phone reports the same outgoing call 10s later with its own client_call_id
    const recRes = await recordDeviceCall(
      models,
      "tenant_db",
      { operator_device_id: 3, call_logging_scope: "customers_and_contacts" },
      {
        client_call_id: "android-call-999",
        raw_number: "0771234567",
        direction: "OUTGOING",
        state: "ENDED",
        started_at: "2026-11-25T10:00:10Z",
        ended_at: "2026-11-25T10:01:00Z",
        duration_seconds: 50,
      },
      { now: new Date("2026-11-25T10:01:00Z") },
    );

    expect(callStore).toHaveLength(1); // Merged, never two rows!
    expect(callStore[0].client_call_id).toBe("android-call-999");
    expect(recRes.invoice_ids).toEqual([88]);
    expect(recRes.suggested_outcome).toBe("answered");

    // Standalone phone call without invoice_ids auto-links open bills
    const recRes2 = await recordDeviceCall(
      models,
      "tenant_db",
      { operator_device_id: 3, call_logging_scope: "customers_and_contacts" },
      {
        client_call_id: "android-call-1000",
        raw_number: "0771234567",
        direction: "INCOMING",
        state: "ENDED",
        started_at: "2026-11-25T11:00:00Z",
        ended_at: "2026-11-25T11:00:02Z",
        duration_seconds: 2,
      },
      { now: new Date("2026-11-25T11:00:02Z") },
    );
    expect(recRes2.invoice_ids).toEqual([88]);
    expect(recRes2.suggested_outcome).toBe("no_answer");
  });

  it("5. linkCallToCustomer adds unknown number to customer and re-links call and notes", async () => {
    const callRow = {
      call_id: 77,
      phone_e164: "94779998888",
      raw_number: "0779998888",
      customer_id: null,
      invoice_ids: null,
      started_at: new Date(),
      update: vi.fn(async (p) => Object.assign(callRow, p)),
    };
    const customer = {
      customer_id: 21,
      phone_number: "0771112222",
      customer_delete_status: false,
      update: vi.fn(async (p) => Object.assign(customer, p)),
    };
    const models = {
      TenantConfig: { findOne: vi.fn().mockResolvedValue({ custom_settings: {} }) },
      CallLog: { findByPk: vi.fn().mockResolvedValue(callRow) },
      Customer: { findByPk: vi.fn().mockResolvedValue(customer) },
      CustomerPhone: {
        findOne: vi.fn().mockResolvedValue(null),
        destroy: vi.fn().mockResolvedValue(0),
        bulkCreate: vi.fn().mockResolvedValue([]),
      },
      CallNote: { update: vi.fn().mockResolvedValue([1]) },
      sequelize: {
        constructor: { QueryTypes: { SELECT: "SELECT" } },
        query: vi.fn().mockResolvedValue([{ invoice_id: 301, owed: 1000, units_out: 0 }]),
      },
    };

    const res = await linkCallToCustomer(models, 77, { customer_id: 21 });
    expect(res.customer_id).toBe(21);
    expect(customer.phone_number).toContain("0779998888");
    expect(callRow.customer_id).toBe(21);
    expect(callRow.invoice_ids).toEqual([301]);
    expect(models.CallNote.update).toHaveBeenCalled();
  });

  it("6. NIC search matches with and without trailing V/X", async () => {
    const capturedWhere = [];
    const models = {
      Customer: {
        findAll: vi.fn(async ({ where }) => {
          capturedWhere.push(where);
          return [{ customer_id: 1 }];
        }),
      },
      CustomerPhone: { findAll: vi.fn().mockResolvedValue([]) },
    };
    await findCustomerIdsBySearch(models, "901234567V");
    await findCustomerIdsBySearch(models, "901234567");
    expect(util.inspect(capturedWhere[0], { depth: 6 })).toContain("901234567");
    expect(util.inspect(capturedWhere[1], { depth: 6 })).toContain("901234567");
  });

  it("7. Collections report filters, sorts, totals, dashboard parity, and customer filters_on", async () => {
    // Seeded dataset:
    // Customer 1: owes 10000, 2 units out, overdue 14 days, rating 5, not blacklisted
    // Customer 2: owes 5000, 0 units out, returned 40 days ago (late money), rating 3, blacklisted
    // Customer 3: owes 0, 1 unit out, not overdue, rating 4, not blacklisted
    const seededCustomers = [
      {
        customer_id: 1,
        customer_type: "Individual",
        first_name: "Kasun",
        last_name: "Perera",
        company_name: null,
        phone_number: "0771111111",
        nic_number: "901234567V",
        status: "Active",
        rating: 5,
        invoice_count: 1,
        not_complete_count: 1,
        complete_count: 0,
        revenue: 15000,
        paid: 5000,
        balance: 10000,
        units_out: 2,
        overdue_units_out: 2,
        longest_overdue_days: 14,
        overdue_accrued_money: 2000,
        late_money_returned: 0,
        last_bill_date: "2026-11-01",
        oldest_unpaid_bill: "2026-11-01",
        oldest_due_date: "2026-11-11",
        last_payment_date: "2026-11-02",
      },
      {
        customer_id: 2,
        customer_type: "Individual",
        first_name: "Nimal",
        last_name: "Silva",
        company_name: null,
        phone_number: "0772222222",
        nic_number: "881234567",
        status: "Blacklisted",
        rating: 3,
        invoice_count: 1,
        not_complete_count: 1,
        complete_count: 0,
        revenue: 5000,
        paid: 0,
        balance: 5000,
        units_out: 0,
        overdue_units_out: 0,
        longest_overdue_days: 0,
        overdue_accrued_money: 0,
        late_money_returned: 5000,
        last_bill_date: "2026-10-01",
        oldest_unpaid_bill: "2026-10-01",
        oldest_due_date: null,
        last_payment_date: null,
      },
      {
        customer_id: 3,
        customer_type: "Business",
        first_name: null,
        last_name: null,
        company_name: "Apex Builders",
        phone_number: "0773333333",
        nic_number: null,
        status: "Active",
        rating: 4,
        invoice_count: 1,
        not_complete_count: 1,
        complete_count: 0,
        revenue: 4000,
        paid: 4000,
        balance: 0,
        units_out: 1,
        overdue_units_out: 0,
        longest_overdue_days: 0,
        overdue_accrued_money: 0,
        late_money_returned: 0,
        last_bill_date: "2026-11-20",
        oldest_unpaid_bill: null,
        oldest_due_date: "2026-11-30",
        last_payment_date: "2026-11-20",
      },
    ];

    const models = {
      TenantConfig: { findOne: vi.fn().mockResolvedValue({ custom_settings: {} }) },
      CallLog: { findOne: vi.fn() },
      sequelize: {
        constructor: { QueryTypes: { SELECT: "SELECT" } },
        query: vi.fn(async (sql) => {
          if (sql.includes("FROM CALL_LOGS cl")) return [];
          if (sql.includes("FROM INVOICE_LINES il") && sql.includes("pageCustomerIds")) {
            return [
              { customer_id: 1, equipment_id: 10, name: "Scaffolding", count: 2, overdue_days: 14, out_days: 24 },
              { customer_id: 3, equipment_id: 11, name: "Drill", count: 1, overdue_days: 0, out_days: 5 },
            ];
          }
          if (sql.includes("FROM INVOICES i") && sql.includes("JOIN CUSTOMERS c") && !sql.includes("GROUP BY c.customer_id")) {
            // Dashboard open-invoices raw rows (excludes deleted bills)
            return [
              {
                invoice_id: 101,
                issued_date: "2026-11-01",
                age_days: 24,
                status: "Active",
                customer_id: 1,
                first_name: "Kasun",
                last_name: "Perera",
                customer_type: "Individual",
                phone_number: "0771111111",
                live_total: 15000,
                paid: 5000,
                owed: 10000,
                accrued_charges: 2000,
                units_out: 2,
                earliest_due_date: "2026-11-11",
                days_overdue: 14,
                open_ended: 0,
              },
              {
                invoice_id: 102,
                issued_date: "2026-10-01",
                age_days: 55,
                status: "PendingPayment",
                customer_id: 2,
                first_name: "Nimal",
                last_name: "Silva",
                customer_type: "Individual",
                phone_number: "0772222222",
                live_total: 5000,
                paid: 0,
                owed: 5000,
                accrued_charges: 0,
                units_out: 0,
                earliest_due_date: null,
                days_overdue: 0,
                open_ended: 0,
              },
              {
                invoice_id: 103,
                issued_date: "2026-11-20",
                age_days: 5,
                status: "Active",
                customer_id: 3,
                company_name: "Apex Builders",
                customer_type: "Business",
                phone_number: "0773333333",
                live_total: 4000,
                paid: 4000,
                owed: 0,
                accrued_charges: 0,
                units_out: 1,
                earliest_due_date: "2026-11-30",
                days_overdue: 0,
                open_ended: 0,
              },
            ];
          }
          if (sql.includes("GROUP BY il.invoice_id, il.equipment_id")) return [];
          return seededCustomers;
        }),
      },
    };

    // Option: owes_money
    const owesRes = await getCollectionsReport(models, { options: "owes_money" });
    expect(owesRes.rows.map((r) => r.customer_id)).toEqual([1, 2]);
    expect(owesRes.totals.balance).toBe(15000);
    expect(owesRes.totals.balance).toBe(
      owesRes.rows.reduce((s, r) => s + r.balance, 0),
    );

    // Dashboard parity check: view=money, olderThanDays=0
    const dashMoney = await getOpenInvoices(models, { view: "money", olderThanDays: 0 });
    expect(dashMoney.summary.money.owed).toBe(owesRes.totals.balance);

    // Combinable options: owes_money + not_returned
    const comboRes = await getCollectionsReport(models, { options: "owes_money,not_returned" });
    expect(comboRes.rows.map((r) => r.customer_id)).toEqual([1]);

    // Filter: blacklisted + sort asc by balance
    const blRes = await getCollectionsReport(models, { blacklisted: "true", sort_by: "balance", sort_dir: "asc" });
    expect(blRes.rows.map((r) => r.customer_id)).toEqual([2]);

    // Filter: balance_min=6000 + rating=5
    const pairRes = await getCollectionsReport(models, { balance_min: 6000, rating: 5 });
    expect(pairRes.rows.map((r) => r.customer_id)).toEqual([1]);

    // Sort by name asc
    const sortName = await getCollectionsReport(models, { sort_by: "name", sort_dir: "asc" });
    expect(sortName.rows.map((r) => r.name)).toEqual(["Apex Builders", "Kasun Perera", "Nimal Silva"]);

    // Customer detail: filters_on=true vs false
    const detailModels = {
      TenantConfig: { findOne: vi.fn().mockResolvedValue({ custom_settings: {} }) },
      sequelize: {
        constructor: { QueryTypes: { SELECT: "SELECT" } },
        query: vi.fn(async (sql) => {
          if (sql.includes("FROM CUSTOMERS c") && sql.includes("LIMIT 1")) {
            return [seededCustomers[0]];
          }
          if (sql.includes("FROM INVOICES i") && sql.includes("WHERE i.customer_id = :cid")) {
            return [
              {
                invoice_id: 101,
                invoice_number: "INV-101",
                issued_date: "2026-11-01",
                status: "Active",
                subtotal: 13000,
                discount_amount: 0,
                total_amount: 13000,
                accrued_charges: 2000,
                live_total: 15000,
                paid: 5000,
                owed: 10000,
                units_out: 2,
                overdue_units_out: 2,
                days_overdue: 14,
              },
              {
                invoice_id: 100,
                invoice_number: "INV-100",
                issued_date: "2026-09-01",
                status: "Completed",
                subtotal: 8000,
                discount_amount: 0,
                total_amount: 8000,
                accrued_charges: 0,
                live_total: 8000,
                paid: 8000,
                owed: 0,
                units_out: 0,
                overdue_units_out: 0,
                days_overdue: 0,
              },
            ];
          }
          return [];
        }),
      },
    };

    const dFiltered = await getCustomerCollectionsDetail(detailModels, 1, {
      options: "owes_money",
      filters_on: "true",
    });
    expect(dFiltered.filters_on).toBe(true);
    expect(dFiltered.both_totals.filtered.invoice_count).toBe(1);
    expect(dFiltered.both_totals.all.invoice_count).toBe(2);

    const dAll = await getCustomerCollectionsDetail(detailModels, 1, {
      options: "owes_money",
      filters_on: "false",
    });
    expect(dAll.filters_on).toBe(false);
    expect(dAll.both_totals.filtered.invoice_count).toBe(2);
  });

  it("8. call recordings: enabled gate, size/type limits, listen log, dispute hold purge, local & oci drivers, terms line", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gg-rec-test-"));
    const localStorage = createLocalStorageDriver({ baseDir: tmpDir });

    let customSettings = {};
    const configRow = {
      custom_settings: customSettings,
      rental_terms_markdown: "Standard rental terms.",
      rental_terms_version: 1,
      update: vi.fn(async (p) => {
        if (p.custom_settings) {
          customSettings = p.custom_settings;
          configRow.custom_settings = p.custom_settings;
        }
      }),
    };

    const recordings = [];
    const listens = [];
    const callRow = { call_id: 300, client_call_id: "c-300", duration_seconds: 45 };

    const models = {
      TenantConfig: { findOne: vi.fn().mockResolvedValue(configRow) },
      CallLog: {
        findOne: vi.fn().mockResolvedValue(callRow),
        destroy: vi.fn().mockResolvedValue(0),
      },
      CallRecording: {
        findOne: vi.fn(async ({ where }) =>
          recordings.find((r) => r.call_id === where.call_id) || null,
        ),
        findAll: vi.fn(async ({ where }) => {
          if (where.dispute_hold === true) return recordings.filter((r) => r.dispute_hold);
          return recordings.filter((r) => !r.dispute_hold);
        }),
        create: vi.fn(async (data) => {
          await assertSavable(realModels.CallRecording, data);
          const row = {
            recording_id: recordings.length + 1,
            ...data,
            update: vi.fn(async (p) => Object.assign(row, p)),
          };
          recordings.push(row);
          return row;
        }),
        destroy: vi.fn(async ({ where }) => {
          const ids = where.recording_id?.in || [];
          const before = recordings.length;
          for (let i = recordings.length - 1; i >= 0; i -= 1) {
            if (!recordings[i].dispute_hold) recordings.splice(i, 1);
          }
          return before - recordings.length;
        }),
      },
      CallRecordingListen: {
        create: vi.fn(async (data) => {
          await assertSavable(realModels.CallRecordingListen, data);
          const row = { listen_id: listens.length + 1, ...data };
          listens.push(row);
          return row;
        }),
      },
    };

    const audioFile = {
      originalname: "call.m4a",
      mimetype: "audio/mp4",
      size: 1024,
      buffer: Buffer.from("fake-audio-bytes"),
    };

    // Disabled by default -> 403
    await expect(
      uploadDeviceCallRecording(models, "t1", { operator_device_id: 2 }, "c-300", audioFile, {}, { storage: localStorage }),
    ).rejects.toMatchObject({ statusCode: 403, code: "call_recording_disabled" });

    // Enable recording + terms line
    await updateCollectionsSettings(models, {
      call_recording: { enabled: true, termsLineEnabled: true, retentionDays: 30 },
    });
    const terms = await getRentalTerms(models);
    expect(terms.markdown).toContain("Calls with our shop may be recorded");
    expect(terms.call_recording_terms.enabled).toBe(true);

    // Reject non-audio
    await expect(
      uploadDeviceCallRecording(
        models,
        "t1",
        { operator_device_id: 2 },
        "c-300",
        { originalname: "x.png", mimetype: "image/png", size: 100, buffer: Buffer.from("x") },
        {},
        { storage: localStorage },
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "invalid_audio_type" });

    // Reject > 50 MB
    await expect(
      uploadDeviceCallRecording(
        models,
        "t1",
        { operator_device_id: 2 },
        "c-300",
        { originalname: "big.m4a", mimetype: "audio/mp4", size: 51 * 1024 * 1024, buffer: Buffer.from("x") },
        {},
        { storage: localStorage },
      ),
    ).rejects.toMatchObject({ statusCode: 413, code: "recording_too_large" });

    // Valid upload + local driver round trip
    const uploaded = await uploadDeviceCallRecording(
      models,
      "t1",
      { operator_device_id: 2 },
      "c-300",
      audioFile,
      {},
      { storage: localStorage, now: new Date("2026-09-01T00:00:00Z") },
    );
    expect(uploaded.recording_id).toBe(1);

    const playback = await getCallRecordingPlayback(models, 1, 300, { storage: localStorage });
    expect(playback.mode).toBe("stream");
    expect(listens).toHaveLength(1);
    expect(listens[0].user_id).toBe(1);
    await new Promise((resolve) => {
      playback.stream.on("end", resolve);
      playback.stream.on("close", resolve);
      playback.stream.resume();
    });

    // Dispute hold protects from retention purge
    await setCallRecordingDisputeHold(models, 300, { dispute_hold: true });
    const purgeHeld = await purgeExpiredCallLogs(models, {
      now: new Date("2026-11-25T00:00:00Z"),
      storage: localStorage,
    });
    expect(purgeHeld.recordings_deleted).toBe(0);
    expect(recordings).toHaveLength(1);

    // Release hold -> purged & local file deleted
    await setCallRecordingDisputeHold(models, 300, { dispute_hold: false });
    const purgeReleased = await purgeExpiredCallLogs(models, {
      now: new Date("2026-11-25T00:00:00Z"),
      storage: localStorage,
    });
    expect(purgeReleased.recordings_deleted).toBe(1);

    // OCI driver with mocked fetch
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const oci = createOciStorageDriver({
      bucket: "gg-rec",
      region: "ap-mumbai-1",
      namespace: "ns1",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret-key",
      fetchImpl: fetchMock,
    });
    await oci.putObject({ key: "t1/300/test.m4a", buffer: Buffer.from("abc"), contentType: "audio/mp4" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ns1.compat.objectstorage.ap-mumbai-1.oraclecloud.com/gg-rec/t1/300/test.m4a",
      expect.objectContaining({ method: "PUT" }),
    );
    const signedUrl = await oci.getSignedUrl({ key: "t1/300/test.m4a", expiresInSeconds: 300 });
    expect(signedUrl).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(signedUrl).toContain("X-Amz-Signature=");
    await oci.deleteObject({ key: "t1/300/test.m4a" });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://ns1.compat.objectstorage.ap-mumbai-1.oraclecloud.com/gg-rec/t1/300/test.m4a",
      expect.objectContaining({ method: "DELETE" }),
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
