import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GetDevicePolicyContract,
  LookupDeviceBriefContract,
  UpdateDeviceSettingsContract,
} from "@geargrid/contracts";

const mockSendDataPush = vi.fn().mockResolvedValue({ sent: true });
const mockSendPushToDevice = vi.fn().mockResolvedValue({ sent: true });
const mockSendToUsers = vi.fn().mockResolvedValue({ sent: 1, reached: 1 });
const mockGetTenantPlan = vi.fn().mockResolvedValue({
  plan_code: "pro",
  features: { phone_assistant: true },
});
const mockCreateNotification = vi.fn().mockResolvedValue({});

vi.mock("../../src/services/devicePushService.js", async () => {
  const actual = await vi.importActual("../../src/services/devicePushService.js");
  return {
    ...actual,
    sendDataPush: (...args) => mockSendDataPush(...args),
    sendPushToDevice: (...args) => mockSendPushToDevice(...args),
    sendToUsers: (...args) => mockSendToUsers(...args),
  };
});

vi.mock("../../src/services/planService.js", () => ({
  getTenantPlan: (...args) => mockGetTenantPlan(...args),
}));

vi.mock("../../src/services/notificationService.js", () => ({
  createNotification: (...args) => mockCreateNotification(...args),
}));

const {
  getPhoneAssistantPolicy,
  updatePhoneAssistantPolicy,
  resolveDeviceBriefProfile,
} = await import("../../src/services/phoneAssistantPolicyService.js");
const {
  buildBriefs,
  syncDeviceBriefs,
  lookupDeviceBrief,
} = await import("../../src/services/customerBriefService.js");
const {
  updateShopDevice,
  getDevicePolicy,
  updateDeviceSettings,
} = await import("../../src/services/deviceService.js");
const {
  getUserPushPreferences,
  updateUserPushPreferences,
  notifyEvent,
  flushPushDigests,
  sendDailySummaryPush,
  __resetPushDigestBucketsForTests,
} = await import("../../src/services/pushEventService.js");
const devicePushServiceActual = await vi.importActual("../../src/services/devicePushService.js");

const makeCustomer = (overrides = {}) => ({
  customer_id: 1,
  first_name: "Kamal",
  last_name: "Perera",
  company_name: "K&P Builders",
  ParentCompany: null,
  phone_number: "0771234567",
  rating: 4,
  status: "Active",
  deposit_balance: 5400,
  is_id_retained_currently: true,
  customer_delete_status: false,
  brief_changed_at: new Date("2026-11-15T10:00:00Z"),
  ...overrides,
});

const makeInvoice = (overrides = {}) => ({
  invoice_id: 101,
  customer_id: 1,
  issued_date: "2026-11-01",
  status: "Active",
  is_deleted: false,
  id_card_status: 1,
  total_amount: 12450,
  discount_amount: 0,
  InvoiceLines: [
    {
      equipment_id: 10,
      Equipment: { equipment_id: 10, equipment_name: "Breaker Hammer" },
      borrow_quantity: 2,
      good_returned_qty: 0,
      defective_returned_qty: 0,
      line_status: "Active",
      expected_return_date: "2026-11-10",
      track_overdue: true,
      is_open_ended: false,
    },
  ],
  Payments: [
    {
      payment_id: 501,
      invoice_id: 101,
      payment_amount: 2450,
      payment_date: "2026-11-05",
      method: "Cash",
      is_voided: false,
    },
  ],
  ...overrides,
});

describe("Release 2 Part C.1 — Caller brief profiles & settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenantPlan.mockResolvedValue({
      plan_code: "pro",
      features: { phone_assistant: true },
    });
  });

  it("strips all financial amounts from counter phone briefs in API response and summary_line", async () => {
    const now = new Date("2026-11-15T10:00:00Z");
    const staffUser = {
      user_id: 2,
      is_active: true,
      Roles: [{ role_id: 2, role_name: "Counter Staff", hierarchy_level: 10, is_active: true, Permissions: [{ permission_code: "calls:view" }] }],
    };
    const device = {
      operator_device_id: 8,
      device_id: "counter-phone-1",
      user_id: 2,
      status: "ACTIVE",
      brief_profile_id: null,
      update: vi.fn().mockResolvedValue(true),
    };

    const models = {
      TenantConfig: {
        findOne: vi.fn().mockResolvedValue({ custom_settings: {} }),
      },
      User: {
        findByPk: vi.fn().mockResolvedValue(staffUser),
      },
      Customer: {
        findAll: vi
          .fn()
          .mockResolvedValueOnce([{ customer_id: 1 }])
          .mockResolvedValueOnce([makeCustomer({ customer_id: 1 })]),
      },
      CustomerPhone: {
        findAll: vi
          .fn()
          .mockResolvedValue([{ phone_id: 1, customer_id: 1, phone_e164: "94771234567", is_primary: true }]),
      },
      Invoice: {
        findAll: vi.fn().mockResolvedValue([makeInvoice({ customer_id: 1, total_amount: 12450, Payments: [] })]),
      },
      InvoiceReview: {
        findAll: vi.fn().mockResolvedValue([]),
      },
    };

    const synced = await syncDeviceBriefs(models, device, {}, { now });
    expect(synced.briefs).toHaveLength(1);
    const brief = synced.briefs[0];
    expect(brief.display_name).toBe("Kamal Perera");
    expect(brief.balance_due).toBeUndefined();
    expect(brief.deposit_balance).toBeUndefined();
    expect(brief.last_payment).toBeUndefined();
    expect(brief.has_dues).toBeUndefined();
    expect(brief.summary_line).not.toMatch(/LKR|Rs\.|Owes/i);
    expect(brief.summary_line).toContain("★4");
    expect(brief.summary_line).toContain("1 item overdue");
  });

  it("supports rounded (nearest 1,000) and flag_only amount modes cleanly", async () => {
    const now = new Date("2026-11-15T10:00:00Z");
    const models = {
      Customer: {
        findAll: vi.fn().mockResolvedValue([makeCustomer({ customer_id: 1, deposit_balance: 5400 })]),
      },
      CustomerPhone: {
        findAll: vi
          .fn()
          .mockResolvedValue([{ phone_id: 1, customer_id: 1, phone_e164: "94771234567", is_primary: true }]),
      },
      Invoice: {
        findAll: vi.fn().mockResolvedValue([
          makeInvoice({
            customer_id: 1,
            total_amount: 12450,
            Payments: [{ payment_id: 501, invoice_id: 101, payment_amount: 2600, payment_date: "2026-11-05", method: "Cash", is_voided: false }],
          }),
        ]),
      },
      InvoiceReview: { findAll: vi.fn().mockResolvedValue([]) },
    };

    // Total = 12450, paid = 2600 -> balance_due = 9850 -> rounded = 10000; deposit 5400 -> 5000; payment 2600 -> 3000
    const [roundedBrief] = await buildBriefs(models, [1], {
      now,
      profile: {
        id: "rounded_mgr",
        name: "Manager",
        fields: ["*"],
        lock_screen: "name_only",
        amounts: "rounded",
      },
    });
    expect(roundedBrief.balance_due).toBe(10000);
    expect(roundedBrief.deposit_balance).toBe(5000);
    expect(roundedBrief.last_payment?.amount).toBe(3000);
    expect(roundedBrief.summary_line).toContain("Owes LKR 10,000");

    const [flagBrief] = await buildBriefs(models, [1], {
      now,
      profile: {
        id: "flag_staff",
        name: "Senior",
        fields: ["name", "rating", "balance_due", "active_items"],
        lock_screen: "name_only",
        amounts: "flag_only",
      },
    });
    expect(flagBrief.balance_due).toBeUndefined();
    expect(flagBrief.has_dues).toBe(true);
    expect(flagBrief.summary_line).toContain("Has dues");
    expect(flagBrief.summary_line).not.toMatch(/LKR/);
  });

  it("clears briefs_synced_at and sends wipe_cache + policy_changed when profile or cache_scope changes", async () => {
    const configRow = {
      custom_settings: { phone_assistant: {} },
      update: vi.fn(async (patch) => {
        configRow.custom_settings = patch.custom_settings;
        return configRow;
      }),
    };
    const devRow = {
      operator_device_id: 5,
      user_id: 2,
      device_id: "phone-5",
      push_token: "tok-5",
      is_native_app: true,
      status: "ACTIVE",
      brief_profile_id: "counter",
      briefs_synced_at: new Date(),
      capabilities: { caller_brief: true },
      update: vi.fn(async (patch) => Object.assign(devRow, patch)),
    };

    const models = {
      TenantConfig: { findOne: vi.fn().mockResolvedValue(configRow) },
      OperatorDevice: {
        findByPk: vi.fn().mockResolvedValue(devRow),
        findAll: vi.fn().mockResolvedValue([devRow]),
        update: vi.fn().mockResolvedValue([1]),
      },
      DeviceAuditLog: { create: vi.fn().mockResolvedValue({}) },
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 2,
          is_active: true,
          Roles: [{ role_id: 2, role_name: "Staff", hierarchy_level: 10, is_active: true }],
        }),
      },
    };

    await updateShopDevice(models, 5, { brief_profile_id: "owner" }, { userId: 1 });
    expect(devRow.briefs_synced_at).toBeNull();
    expect(mockSendDataPush).toHaveBeenCalledWith(devRow, { type: "wipe_cache" });
    expect(mockSendDataPush).toHaveBeenCalledWith(devRow, { type: "policy_changed" });

    vi.clearAllMocks();
    await updatePhoneAssistantPolicy(models, { cache_scope: "with_dues_or_active" });
    expect(models.OperatorDevice.update).toHaveBeenCalledWith(
      { briefs_synced_at: null },
      expect.any(Object),
    );
    expect(mockSendDataPush).toHaveBeenCalledWith(devRow, { type: "wipe_cache" });
    expect(mockSendDataPush).toHaveBeenCalledWith(devRow, { type: "policy_changed" });
  });

  it("filters syncDeviceBriefs by cache_scope and puts excluded IDs in deleted_customer_ids on delta sync", async () => {
    const now = new Date("2026-11-15T10:00:00Z");
    const models = {
      TenantConfig: {
        findOne: vi.fn().mockResolvedValue({
          custom_settings: { phone_assistant: { cache_scope: "with_dues_or_active" } },
        }),
      },
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 1,
          is_active: true,
          Roles: [{ role_id: 1, role_name: "Admin", hierarchy_level: 100, is_active: true }],
        }),
      },
      Customer: {
        findAll: vi
          .fn()
          .mockResolvedValueOnce([{ customer_id: 1 }, { customer_id: 2 }])
          .mockResolvedValueOnce([
            makeCustomer({ customer_id: 1, first_name: "Owes" }),
            makeCustomer({ customer_id: 2, first_name: "Settled" }),
          ])
          .mockResolvedValueOnce([]),
      },
      CustomerPhone: { findAll: vi.fn().mockResolvedValue([]) },
      Invoice: {
        findAll: vi.fn().mockResolvedValue([
          makeInvoice({ customer_id: 1, total_amount: 5000, Payments: [] }),
        ]),
      },
      InvoiceReview: { findAll: vi.fn().mockResolvedValue([]) },
    };

    const device = { operator_device_id: 1, user_id: 1, update: vi.fn().mockResolvedValue(true) };
    const res = await syncDeviceBriefs(
      models,
      device,
      { since: "2026-11-01T00:00:00Z" },
      { now },
    );

    expect(res.briefs.map((b) => b.customer_id)).toEqual([1]);
    expect(res.deleted_customer_ids).toContain(2);
  });

  it("supports shared_number modes (list_all vs first_only) and /device/policy + /device/settings", async () => {
    const models = {
      TenantConfig: {
        findOne: vi.fn().mockResolvedValue({
          custom_settings: {
            phone_assistant: {
              shared_number: "list_all",
              overlay: { position: "bottom", auto_dismiss_seconds: 10, show_for: "incoming_and_outgoing" },
            },
          },
        }),
      },
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 1,
          is_active: true,
          Roles: [{ role_id: 1, role_name: "Admin", hierarchy_level: 100, is_active: true }],
        }),
      },
      CustomerPhone: {
        findAll: vi
          .fn()
          .mockResolvedValueOnce([{ customer_id: 1 }, { customer_id: 2 }])
          .mockResolvedValueOnce([
            { phone_id: 1, customer_id: 1, phone_e164: "94771234567", is_primary: true },
            { phone_id: 2, customer_id: 2, phone_e164: "94771234567", is_primary: true },
          ]),
      },
      Customer: {
        findAll: vi.fn().mockResolvedValue([
          makeCustomer({ customer_id: 1, first_name: "First" }),
          makeCustomer({ customer_id: 2, first_name: "Second" }),
        ]),
      },
      Invoice: { findAll: vi.fn().mockResolvedValue([]) },
      InvoiceReview: { findAll: vi.fn().mockResolvedValue([]) },
      DeviceAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    const device = {
      operator_device_id: 9,
      user_id: 1,
      status: "ACTIVE",
      muted: false,
      contact_sync_mode: "off",
      call_logging_scope: "customers_and_contacts",
      sim_filter: null,
      update: vi.fn(async (patch) => Object.assign(device, patch)),
    };

    const lookupAll = await lookupDeviceBrief(models, device, { phone: "0771234567" });
    expect(lookupAll.match).toBe("customer");
    expect(lookupAll.briefs).toHaveLength(2);
    expect(() => LookupDeviceBriefContract.response.shape.data.parse(lookupAll)).not.toThrow();

    const policyRes = await getDevicePolicy(models, "geargrid_test", device);
    expect(policyRes.overlay.position).toBe("bottom");
    expect(policyRes.brief_profile.id).toBe("owner");
    expect(() => GetDevicePolicyContract.response.shape.data.parse(policyRes)).not.toThrow();

    const settingsRes = await updateDeviceSettings(models, "geargrid_test", device, {
      muted: true,
      sim_filter: "SIM 1",
    });
    expect(settingsRes.muted).toBe(true);
    expect(settingsRes.sim_filter).toBe("SIM 1");
    expect(() => UpdateDeviceSettingsContract.response.shape.data.parse(settingsRes)).not.toThrow();
  });
});

describe("Release 2 Part C.2 — Extended push notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetPushDigestBucketsForTests();
    devicePushServiceActual.__resetDevicePushForTests();
    mockGetTenantPlan.mockResolvedValue({
      plan_code: "pro",
      features: { phone_assistant: true },
    });
  });

  it("redacts customer name when hide_customer_name is enabled on an event", async () => {
    const models = {
      TenantConfig: {
        findOne: vi.fn().mockResolvedValue({
          timezone: "Asia/Colombo",
          custom_settings: {
            phone_assistant: {
              push: {
                events: {
                  invoice_created: {
                    enabled: true,
                    min_amount: 0,
                    recipient_role_ids: [],
                    hide_customer_name: true,
                    delivery: "instant",
                  },
                },
              },
            },
          },
        }),
      },
      User: {
        findAll: vi.fn().mockResolvedValue([
          { user_id: 1, is_active: true, Roles: [{ role_id: 1, hierarchy_level: 100, is_active: true }] },
        ]),
      },
      PushPreference: { findAll: vi.fn().mockResolvedValue([]) },
    };

    await notifyEvent(models, "invoice_created", {
      amount: 10000,
      customerName: "Saman Perera",
      title: "New bill #15 · LKR 10,000",
      body: "Saman Perera · 2 item(s) · by Kasun",
      data: { type: "invoice_created", invoice_id: "15" },
    });

    expect(mockSendToUsers).toHaveBeenCalledWith(
      models,
      [1],
      expect.objectContaining({
        body: "Customer · 2 item(s) · by Kasun",
        channel: "bills",
        silent: false,
      }),
    );
  });

  it("applies personal quiet hours per user and saves/reads quiet_from & quiet_to", async () => {
    const prefRows = [];
    const models = {
      TenantConfig: {
        findOne: vi.fn().mockResolvedValue({
          timezone: "Asia/Colombo",
          custom_settings: { phone_assistant: { push: {} } },
        }),
      },
      User: {
        findAll: vi.fn().mockResolvedValue([
          { user_id: 1, is_active: true, Roles: [{ role_id: 1, hierarchy_level: 100, is_active: true }] },
          { user_id: 2, is_active: true, Roles: [{ role_id: 1, hierarchy_level: 100, is_active: true }] },
        ]),
        findByPk: vi.fn().mockResolvedValue({
          user_id: 1,
          is_active: true,
          Roles: [{ role_id: 1, hierarchy_level: 100, is_active: true }],
        }),
      },
      PushPreference: {
        findAll: vi.fn().mockImplementation(async ({ where }) => {
          if (Array.isArray(where?.user_id?.[Symbol.for("sequelize.op.in")] || where?.user_id)) {
            return prefRows;
          }
          return prefRows.filter((r) => Number(r.user_id) === Number(where.user_id));
        }),
        findOne: vi.fn().mockImplementation(async ({ where }) =>
          prefRows.find((r) => Number(r.user_id) === Number(where.user_id)) ?? null,
        ),
        create: vi.fn().mockImplementation(async (row) => {
          const entry = { ...row, update: vi.fn(async (p) => Object.assign(entry, p)) };
          prefRows.push(entry);
          return entry;
        }),
      },
    };

    const device = {
      operator_device_id: 10,
      user_id: 1,
      muted: false,
      update: vi.fn(async (p) => Object.assign(device, p)),
    };

    const saved = await updateUserPushPreferences(
      models,
      1,
      {
        preferences: [{ event_key: "payment_received", enabled: true, min_amount: null }],
        quiet_hours: { enabled: true, from: "20:00", to: "07:00" },
        muted: true,
      },
      device,
    );

    expect(saved.quiet_hours).toEqual({ enabled: true, from: "20:00", to: "07:00" });
    expect(saved.muted).toBe(true);
    expect(device.muted).toBe(true);

    const fetched = await getUserPushPreferences(models, 1, device);
    expect(fetched.quiet_hours).toEqual({ enabled: true, from: "20:00", to: "07:00" });

    // 22:00 Asia/Colombo = 16:30 UTC -> user 1 is in personal quiet hours, user 2 is loud
    models.PushPreference.findAll = vi.fn().mockResolvedValue(prefRows);
    await notifyEvent(models, "payment_received", {
      amount: 5000,
      title: "Payment on #42 · LKR 5,000",
      body: "Kamal · Cash",
      now: new Date("2026-11-15T16:30:00Z"),
    });

    expect(mockSendToUsers).toHaveBeenCalledWith(
      models,
      [2],
      expect.objectContaining({ silent: false, channel: "payments" }),
    );
    expect(mockSendToUsers).toHaveBeenCalledWith(
      models,
      [1],
      expect.objectContaining({ silent: true, channel: "bills_silent" }),
    );
  });

  it("skips muted or suspended devices in real devicePushService.sendToUsers", async () => {
    const sendMock = vi.fn().mockResolvedValue("ok");
    devicePushServiceActual.__setMessagingForTests({ send: sendMock });

    const models = {
      OperatorDevice: {
        findAll: vi.fn().mockResolvedValue([
          { operator_device_id: 1, user_id: 1, status: "ACTIVE", muted: true, push_token: "muted-tok" },
          { operator_device_id: 2, user_id: 1, status: "SUSPENDED", muted: false, push_token: "susp-tok" },
          { operator_device_id: 3, user_id: 1, status: "ACTIVE", muted: false, push_token: "live-tok" },
        ]),
      },
    };

    const res = await devicePushServiceActual.sendToUsers(models, [1], {
      title: "Test",
      body: "Body",
      channel: "bills",
    });

    expect(res).toEqual({ sent: 1, reached: 1 });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].token).toBe("live-tok");
  });

  it("batches digest events and dispatches daily summary on channel 'digest'", async () => {
    const models = {
      sequelize: { config: { database: "geargrid_digest_test" } },
      TenantConfig: {
        findOne: vi.fn().mockResolvedValue({
          timezone: "Asia/Colombo",
          custom_settings: {
            phone_assistant: {
              push: {
                digest_minutes: 30,
                events: {
                  invoice_created: { enabled: true, min_amount: 0, recipient_role_ids: [], delivery: "digest" },
                  payment_received: { enabled: true, min_amount: 0, recipient_role_ids: [], delivery: "digest" },
                },
                daily_summary: {
                  enabled: true,
                  send_time: "18:00",
                  recipient_role_ids: [],
                  sections: { bills: true, payments: true, returns: true, due_tomorrow: true, overdue: true },
                },
              },
            },
          },
        }),
      },
      User: {
        findAll: vi.fn().mockResolvedValue([
          { user_id: 1, is_active: true, Roles: [{ role_id: 1, hierarchy_level: 100, is_active: true }] },
        ]),
      },
      PushPreference: { findAll: vi.fn().mockResolvedValue([]) },
      Invoice: {
        findAll: vi.fn().mockResolvedValue([
          makeInvoice({
            invoice_id: 101,
            issued_date: "2026-11-15",
            total_amount: 15000,
            Payments: [{ payment_amount: 5000, payment_date: "2026-11-15", is_voided: false }],
          }),
        ]),
      },
    };

    const q1 = await notifyEvent(models, "invoice_created", {
      amount: 10000,
      title: "Bill #1",
      body: "Kamal",
      now: new Date("2026-11-15T10:00:00Z"),
    });
    const q2 = await notifyEvent(models, "payment_received", {
      amount: 5000,
      title: "Pay #1",
      body: "Kamal",
      now: new Date("2026-11-15T10:05:00Z"),
    });

    expect(q1.queued_digest).toBe(true);
    expect(q2.queued_digest).toBe(true);
    expect(mockSendToUsers).not.toHaveBeenCalled();

    const flushed = await flushPushDigests({ now: new Date("2026-11-15T10:35:00Z") });
    expect(flushed.flushed).toBe(1);
    expect(mockSendToUsers).toHaveBeenCalledWith(
      models,
      [1],
      expect.objectContaining({
        channel: "digest",
        body: expect.stringContaining("1 new bill (LKR 10,000)"),
      }),
    );

    vi.clearAllMocks();
    const summaryRes = await sendDailySummaryPush(models, {
      now: new Date("2026-11-15T12:30:00Z"),
    });
    expect(summaryRes.reached).toBe(1);
    expect(summaryRes.body).toContain("1 bills");
    expect(summaryRes.body).toContain("1 payments");
    expect(mockSendToUsers).toHaveBeenCalledWith(
      models,
      [1],
      expect.objectContaining({ channel: "digest" }),
    );
  });
});
