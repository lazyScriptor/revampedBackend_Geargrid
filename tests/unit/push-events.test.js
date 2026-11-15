import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateNotification = vi.fn().mockResolvedValue({});
const mockSendToUsers = vi.fn().mockResolvedValue({ sent: 1, reached: 1 });
const mockGetTenantPlan = vi.fn().mockResolvedValue(null);

vi.mock("../../src/services/notificationService.js", () => ({
  createNotification: (...args) => mockCreateNotification(...args),
}));

vi.mock("../../src/services/devicePushService.js", () => ({
  sendToUsers: (...args) => mockSendToUsers(...args),
}));

vi.mock("../../src/services/planService.js", () => ({
  getTenantPlan: (...args) => mockGetTenantPlan(...args),
}));

const {
  getPushSettings,
  updatePushSettings,
  getUserPushPreferences,
  updateUserPushPreferences,
  notifyEvent,
  isWithinQuietHours,
} = await import("../../src/services/pushEventService.js");

const makeBaseModels = ({
  pushSettings = {},
  timezone = "Asia/Colombo",
  users = [
    { user_id: 1, is_active: true, Roles: [{ role_id: 1, role_name: "Admin", hierarchy_level: 100, is_active: true }] },
    { user_id: 2, is_active: true, Roles: [{ role_id: 2, role_name: "Manager", hierarchy_level: 50, is_active: true }] },
  ],
  userPrefs = [],
} = {}) => {
  const configRow = {
    timezone,
    custom_settings: { phone_assistant: { push: pushSettings } },
    update: vi.fn(async (patch) => {
      configRow.custom_settings = patch.custom_settings;
      return configRow;
    }),
  };

  return {
    configRow,
    TenantConfig: {
      findOne: vi.fn().mockResolvedValue(configRow),
    },
    User: {
      findAll: vi.fn().mockImplementation(async (opts = {}) => {
        const roleWhere = opts?.include?.[0]?.where;
        if (roleWhere?.role_id) {
          // role filter simulated by callers; return users having that role
          return users;
        }
        return users;
      }),
      findByPk: vi.fn().mockImplementation(async (uid) =>
        users.find((u) => Number(u.user_id) === Number(uid)) ?? null,
      ),
    },
    Role: {},
    PushPreference: {
      findAll: vi.fn().mockResolvedValue(userPrefs),
      findOne: vi.fn().mockImplementation(async ({ where }) =>
        userPrefs.find(
          (p) => Number(p.user_id) === Number(where.user_id) && p.event_key === where.event_key,
        ) ?? null,
      ),
      create: vi.fn().mockImplementation(async (row) => {
        const created = { ...row, update: vi.fn() };
        userPrefs.push(created);
        return created;
      }),
    },
  };
};

describe("pushEventService — helpers", () => {
  it("evaluates overnight and daytime quiet hours in Asia/Colombo", () => {
    const overnight = { enabled: true, from: "21:00", to: "07:00" };
    // 22:30 Asia/Colombo = 17:00 UTC
    expect(isWithinQuietHours(overnight, new Date("2026-11-15T17:00:00Z"), "Asia/Colombo")).toBe(true);
    // 10:00 Asia/Colombo = 04:30 UTC
    expect(isWithinQuietHours(overnight, new Date("2026-11-15T04:30:00Z"), "Asia/Colombo")).toBe(false);
    // 06:15 Asia/Colombo = 00:45 UTC
    expect(isWithinQuietHours(overnight, new Date("2026-11-15T00:45:00Z"), "Asia/Colombo")).toBe(true);

    const daytime = { enabled: true, from: "13:00", to: "15:00" };
    // 14:00 Asia/Colombo = 08:30 UTC
    expect(isWithinQuietHours(daytime, new Date("2026-11-15T08:30:00Z"), "Asia/Colombo")).toBe(true);
  });
});

describe("pushEventService — settings & preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenantPlan.mockResolvedValue(null);
  });

  it("ignores unknown event keys (such as the removed contact_used) instead of failing the save", async () => {
    const models = makeBaseModels();

    await expect(
      updatePushSettings(models, {
        events: { contact_used: { enabled: true, min_amount: 0, recipient_role_ids: [] } },
      }),
    ).resolves.toBeDefined();

    await expect(
      updateUserPushPreferences(models, 1, {
        preferences: [{ event_key: "contact_used", enabled: false, min_amount: null }],
      }),
    ).resolves.toBeDefined();
    expect(models.PushPreference.create).not.toHaveBeenCalled();
  });

  it("no longer offers the contact_used alert", async () => {
    const { PUSH_EVENT_KEYS } = await import("../../src/config/pushEvents.js");
    expect(PUSH_EVENT_KEYS).not.toContain("contact_used");
  });

  it("persists valid push settings and computes eligibility per role", async () => {
    const models = makeBaseModels();
    await updatePushSettings(models, {
      events: {
        invoice_created: { enabled: true, min_amount: 5000, recipient_role_ids: [2] },
        invoice_restored: { enabled: true, min_amount: 0, recipient_role_ids: [] },
      },
      include_amounts: false,
    });

    const { settings, catalog } = await getPushSettings(models);
    expect(catalog.map((c) => c.key)).toContain("invoice_created");
    expect(settings.include_amounts).toBe(false);
    expect(settings.events.invoice_created.recipient_role_ids).toEqual([2]);

    const managerPrefs = await getUserPushPreferences(models, 2);
    const createdPref = managerPrefs.preferences.find((p) => p.event_key === "invoice_created");
    const restoredPref = managerPrefs.preferences.find((p) => p.event_key === "invoice_restored");
    expect(createdPref).toMatchObject({ eligible: true, shop_enabled: true, shop_min_amount: 5000 });
    expect(restoredPref).toMatchObject({ eligible: false, shop_enabled: true });
  });
});

describe("pushEventService — notifyEvent resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenantPlan.mockResolvedValue(null);
  });

  it("drops disabled events and amounts below shop min_amount", async () => {
    const models = makeBaseModels({
      pushSettings: {
        events: {
          invoice_restored: { enabled: false, min_amount: 0, recipient_role_ids: [] },
          invoice_created: { enabled: true, min_amount: 10000, recipient_role_ids: [] },
        },
      },
    });

    const disabledRes = await notifyEvent(models, "invoice_restored", { amount: 50000, title: "Restored", body: "x" });
    expect(disabledRes.skipped).toBe("disabled");
    expect(mockSendToUsers).not.toHaveBeenCalled();

    const belowRes = await notifyEvent(models, "invoice_created", { amount: 9999, title: "Bill", body: "x" });
    expect(belowRes.skipped).toBe("shop_min_amount");
    expect(mockSendToUsers).not.toHaveBeenCalled();
  });

  it("includes admins + recipient roles and skips actor unless notify_actor is true", async () => {
    const users = [
      { user_id: 1, is_active: true, Roles: [{ role_id: 1, role_name: "Admin", hierarchy_level: 100, is_active: true }] },
      { user_id: 2, is_active: true, Roles: [{ role_id: 2, role_name: "Manager", hierarchy_level: 50, is_active: true }] },
    ];
    const models = makeBaseModels({
      users,
      pushSettings: {
        notify_actor: false,
        events: { invoice_created: { enabled: true, min_amount: 0, recipient_role_ids: [2] } },
      },
    });

    const res1 = await notifyEvent(models, "invoice_created", {
      amount: 5000,
      actorUserId: 1,
      title: "New bill #1 · LKR 5,000",
      body: "Nimal · 1 item(s) · by Admin",
    });
    expect(res1.recipients).toEqual([2]);
    expect(mockSendToUsers).toHaveBeenCalledWith(models, [2], expect.any(Object));

    vi.clearAllMocks();
    models.configRow.custom_settings.phone_assistant.push.notify_actor = true;
    const res2 = await notifyEvent(models, "invoice_created", {
      amount: 5000,
      actorUserId: 1,
      title: "New bill #1 · LKR 5,000",
      body: "Nimal · 1 item(s) · by Admin",
    });
    expect(res2.recipients).toEqual([1, 2]);
  });

  it("allows user preferences to narrow only (raise min_amount or disable), never widen", async () => {
    const users = [
      { user_id: 1, is_active: true, Roles: [{ role_id: 1, role_name: "Admin", hierarchy_level: 100, is_active: true }] },
      { user_id: 2, is_active: true, Roles: [{ role_id: 1, role_name: "Admin", hierarchy_level: 100, is_active: true }] },
      { user_id: 3, is_active: true, Roles: [{ role_id: 1, role_name: "Admin", hierarchy_level: 100, is_active: true }] },
    ];
    const models = makeBaseModels({
      users,
      pushSettings: {
        events: { invoice_created: { enabled: true, min_amount: 5000, recipient_role_ids: [] } },
      },
      userPrefs: [
        { user_id: 1, event_key: "invoice_created", enabled: false, min_amount: null },
        { user_id: 2, event_key: "invoice_created", enabled: true, min_amount: 20000 }, // raised above shop 5000
        { user_id: 3, event_key: "invoice_created", enabled: true, min_amount: 1000 }, // tried to lower below 5000 -> effective min stays 5000
      ],
    });

    // Amount = 4000 is blocked at shop rule level even though user 3 set min_amount=1000
    const lowRes = await notifyEvent(models, "invoice_created", { amount: 4000, title: "Low", body: "Low" });
    expect(lowRes.skipped).toBe("shop_min_amount");

    // Amount = 12000 passes shop 5000 and user 3, but blocked for user 1 (disabled) and user 2 (raised to 20000)
    const midRes = await notifyEvent(models, "invoice_created", { amount: 12000, title: "Mid", body: "Mid" });
    expect(midRes.recipients).toEqual([3]);
  });

  it("renders without amounts when include_amounts is false and passes silent=true during quiet hours", async () => {
    const models = makeBaseModels({
      pushSettings: {
        include_amounts: false,
        quiet_hours: { enabled: true, from: "21:00", to: "07:00" },
        events: { payment_received: { enabled: true, min_amount: 0, recipient_role_ids: [] } },
      },
    });

    // 23:00 Colombo = 17:30 UTC
    const res = await notifyEvent(models, "payment_received", {
      amount: 15000,
      vars: { invoice_no: "42", amount: 15000, customer: "Nimal", balance: 500 },
      now: new Date("2026-11-15T17:30:00Z"),
    });

    expect(res.silent).toBe(true);
    const sent = mockSendToUsers.mock.calls[0][2];
    expect(sent.silent).toBe(true);
    expect(sent.title).toBe("Payment received");
    expect(sent.body).toBe("Nimal");
    expect(`${sent.title} ${sent.body}`).not.toMatch(/LKR|15,000|500/);
  });

  it("still accepts finished title/body from older callers", async () => {
    const models = makeBaseModels({
      pushSettings: { events: { payment_received: { enabled: true, min_amount: 0, recipient_role_ids: [] } } },
    });
    await notifyEvent(models, "payment_received", {
      amount: 100,
      title: "Payment on #42 · LKR 100",
      body: "Cash from Nimal",
      now: new Date("2026-11-15T10:00:00Z"),
    });
    expect(mockSendToUsers.mock.calls.at(-1)[2]).toMatchObject({ title: "Payment on #42 · LKR 100", silent: false });
  });
});
