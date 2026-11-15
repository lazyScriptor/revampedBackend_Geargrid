import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateNotification = vi.fn().mockResolvedValue({});
const mockSendToUsers = vi.fn().mockResolvedValue({ sent: 1, reached: 1 });

vi.mock("../../src/services/notificationService.js", () => ({
  createNotification: (...args) => mockCreateNotification(...args),
}));
vi.mock("../../src/services/devicePushService.js", () => ({
  sendToUsers: (...args) => mockSendToUsers(...args),
  sendDataPush: vi.fn().mockResolvedValue({ sent: true }),
}));
vi.mock("../../src/services/planService.js", () => ({
  getTenantPlan: vi.fn().mockResolvedValue(null),
}));

const { notifyEvent } = await import("../../src/services/pushEventService.js");
const {
  renderForRecipient,
  resolveNotificationLanguage,
  validateTemplate,
  saveTemplate,
  listTemplates,
  formatNotificationDate,
  formatNotificationTime,
  renderDraft,
} = await import("../../src/services/pushTemplateService.js");
const {
  mergePhoneAssistantPolicy,
  normalizeCallScreen,
  patchPhoneAssistantPolicy,
  updatePhoneAssistantPolicy,
  computeDeviceHealthWarnings,
} = await import("../../src/services/phoneAssistantPolicyService.js");
const { updateDeviceSettings } = await import("../../src/services/deviceService.js");

const makeConfigModels = (phoneAssistant = {}) => {
  const configRow = {
    timezone: "Asia/Colombo",
    custom_settings: { phone_assistant: phoneAssistant },
    update: vi.fn(async (patch) => {
      configRow.custom_settings = patch.custom_settings;
      return configRow;
    }),
  };
  return { configRow, TenantConfig: { findOne: vi.fn().mockResolvedValue(configRow) } };
};

describe("Release 3 policy schema", () => {
  it("fills every new key with its default", () => {
    const policy = mergePhoneAssistantPolicy({});
    expect(policy.sync).toEqual({ stale_after_minutes: 60, warn_after_hours: 24, show_sync_footer: "always" });
    expect(policy.call_screen).toMatchObject({ allow_phone_text_scale: true, min: 0.8, max: 2, respect_system_font: true });
    expect(policy.notifications).toMatchObject({ default_language: "en", bilingual: "off" });
    expect(policy.notifications.format).toEqual({ currency: "LKR", date: "dd MMM", time: "24h", digits: "latin" });
    expect(policy.desktop_popup.size).toBe("standard");
    expect(policy.full_app).toMatchObject({ enabled: true, session_minutes: 30, block_screenshots: false });
  });

  it("falls back to defaults for out-of-range stored values", () => {
    const policy = mergePhoneAssistantPolicy({
      sync: { stale_after_minutes: 0, show_sync_footer: "sometimes" },
      notifications: { default_language: "fr", format: { time: "13h" } },
      desktop_popup: { size: "huge" },
    });
    expect(policy.sync.stale_after_minutes).toBe(1);
    expect(policy.sync.show_sync_footer).toBe("always");
    expect(policy.notifications.default_language).toBe("en");
    expect(policy.notifications.format.time).toBe("24h");
    expect(policy.desktop_popup.size).toBe("standard");
  });

  it("PUT rejects values outside the allowed set", async () => {
    const models = makeConfigModels();
    await expect(updatePhoneAssistantPolicy(models, { notifications: { bilingual: "both" } })).rejects.toThrow(/bilingual/);
    await expect(updatePhoneAssistantPolicy(models, { notifications: { format: { currency: "$" } } })).rejects.toThrow(/currency/);
    await expect(updatePhoneAssistantPolicy(models, { sync: { stale_after_minutes: 0 } })).rejects.toThrow(/sync.stale_after_minutes/);
    await expect(updatePhoneAssistantPolicy(models, { full_app: { session_minutes: 5000 } })).rejects.toThrow(/session_minutes/);
    await expect(updatePhoneAssistantPolicy(models, { desktop_popup: { size: "huge" } })).rejects.toThrow(/desktop_popup/);
  });

  it("PATCH writes allowed paths only and keeps other tabs' values", async () => {
    const models = makeConfigModels({ sync: { stale_after_minutes: 90 }, offline_wipe_days: 9 });
    const { policy } = await patchPhoneAssistantPolicy(models, [
      { path: "notifications.format.time", value: "12h" },
      { path: "full_app.session_minutes", value: 45 },
    ]);
    expect(policy.notifications.format.time).toBe("12h");
    expect(policy.full_app.session_minutes).toBe(45);
    expect(policy.sync.stale_after_minutes).toBe(90);
    expect(policy.offline_wipe_days).toBe(9);
    await expect(patchPhoneAssistantPolicy(models, [{ path: "capabilities.push", value: false }])).rejects.toThrow(/not editable/);
    await expect(patchPhoneAssistantPolicy(models, [{ path: "__proto__.polluted", value: 1 }])).rejects.toThrow(/not editable/);
    await expect(patchPhoneAssistantPolicy(models, [{ path: "full_app.session_minutes", value: -3 }])).rejects.toThrow();
    expect({}.polluted).toBeUndefined();
  });

  it("a call screen design change does not wipe phone caches", async () => {
    const models = makeConfigModels();
    models.OperatorDevice = { update: vi.fn().mockResolvedValue([1]), findAll: vi.fn().mockResolvedValue([]) };
    const { policy } = await updatePhoneAssistantPolicy(models, {});
    const counter = policy.brief_profiles.find((p) => p.id === "counter");
    const redesigned = policy.brief_profiles.map((p) =>
      p.id === "counter" ? { ...p, call_screen: { ...counter.call_screen, size: "large", text_scale: 1.4 } } : p,
    );
    await updatePhoneAssistantPolicy(models, { brief_profiles: redesigned });
    expect(models.OperatorDevice.update).not.toHaveBeenCalled();
  });
});

describe("call screen design validation", () => {
  it("drops rows whose field the profile may not receive", () => {
    const design = {
      version: 1,
      rows: [
        { field: "name", style: "title" },
        { field: "balance_due", style: "emphasis" },
      ],
    };
    const counter = normalizeCallScreen(design, ["name", "rating"]);
    expect(counter.rows.map((r) => r.field)).toEqual(["name"]);
    const owner = normalizeCallScreen(design, ["*"]);
    expect(owner.rows.map((r) => r.field)).toEqual(["name", "balance_due"]);
  });

  it("ignores unknown keys, clamps ranges and falls back for a newer version", () => {
    const design = normalizeCallScreen(
      {
        version: 1,
        size: "gigantic",
        text_scale: 5,
        shape: { corner_radius: 99, opacity: 0.1, position: "left" },
        rows: [{ field: "name", style: "title", colour: "red" }],
        rules: [{ when: "nonsense" }, { when: "balance_due_over", value: 5000, accent: "warning" }],
        actions: ["dismiss", "add_note", "open_app", "call_back_later"],
      },
      ["*"],
    );
    expect(design.size).toBe("standard");
    expect(design.text_scale).toBe(1);
    expect(design.shape.corner_radius).toBe(28);
    expect(design.shape.opacity).toBe(0.8);
    expect(design.shape.position).toBe("top");
    expect(design.rows[0]).toEqual({ field: "name", style: "title" });
    expect(design.rules).toHaveLength(1);
    expect(design.actions).toHaveLength(3);
    const fallback = normalizeCallScreen({ version: 2, rows: [{ field: "name", style: "title" }] }, ["*"]);
    expect(fallback.version).toBe(1);
    expect(fallback.size).toBe("standard");
  });

  it("saving a profile with a design that has no allowed row is rejected", async () => {
    const models = makeConfigModels();
    const base = mergePhoneAssistantPolicy({}).brief_profiles;
    const bad = base.map((p) =>
      p.id === "counter"
        ? { ...p, call_screen: { version: 1, rows: [{ field: "balance_due", style: "emphasis" }] } }
        : p,
    );
    await expect(updatePhoneAssistantPolicy(models, { brief_profiles: bad })).rejects.toThrow(/call_screen/);
  });
});

describe("notification templates", () => {
  const vars = { invoice_no: "42", amount: 12000, customer: "Nimal Perera", balance: 2500 };

  it("collapses optional segments whose values are hidden or empty", async () => {
    const full = await renderForRecipient({}, "invoice_created", vars, { language: "en" });
    expect(full).toEqual({ title: "New bill #42", body: "Nimal Perera · LKR 12,000" });
    const noAmount = await renderForRecipient({}, "invoice_created", vars, { language: "en", hideAmounts: true });
    expect(noAmount.body).toBe("Nimal Perera");
    const noName = await renderForRecipient({}, "invoice_created", vars, { language: "en", hideCustomer: true });
    expect(noName.body).toBe("LKR 12,000");
    const empty = await renderForRecipient({}, "invoice_created", { invoice_no: "42" }, { language: "en" });
    expect(empty.body).toBe("");
  });

  it("applies currency, date and time formats", async () => {
    const policy = { notifications: { format: { currency: "Rs.", date: "yyyy-mm-dd", time: "12h" } } };
    const out = await renderForRecipient({}, "invoice_created", vars, { language: "en", policy });
    expect(out.body).toContain("Rs. 12,000");
    expect(formatNotificationDate("2026-11-15T04:00:00Z", "dd MMM")).toBe("15 Nov");
    expect(formatNotificationDate("2026-11-15T04:00:00Z", "dd/mm")).toBe("15/11");
    expect(formatNotificationTime("2026-11-15T08:35:00Z", "24h")).toBe("14:05");
    expect(formatNotificationTime("2026-11-15T08:35:00Z", "12h")).toBe("2:05 pm");
  });

  it("renders in each language and appends English when bilingual", async () => {
    const si = await renderForRecipient({}, "invoice_created", vars, { language: "si" });
    expect(si.title).toContain("42");
    expect(si.title).not.toBe("New bill #42");
    const both = await renderForRecipient({}, "invoice_created", vars, {
      language: "si",
      policy: { notifications: { bilingual: "append_english", format: {} } },
    });
    expect(both.body).toContain("\n");
    expect(both.body).toContain("Nimal Perera");
  });

  it("an edited template overrides the default and reset restores it", async () => {
    const rows = [];
    const models = {
      PushTemplate: {
        findOne: vi.fn(async ({ where }) => rows.find((r) => r.event_key === where.event_key && r.language === where.language) || null),
        findAll: vi.fn(async () => rows),
        findOrCreate: vi.fn(async ({ where, defaults }) => {
          const row = { ...defaults, update: vi.fn(async (patch) => Object.assign(row, patch)), toJSON: () => ({ ...row }) };
          rows.push(row);
          return [row, true];
        }),
      },
    };
    await saveTemplate(models, "invoice_created", "en", { title: "Bill {invoice_no}", body: "{customer}" }, 1);
    const out = await renderForRecipient(models, "invoice_created", vars, { language: "en" });
    expect(out.title).toBe("Bill 42");
    const listed = await listTemplates(models);
    expect(listed.templates.find((t) => t.event_key === "invoice_created" && t.language === "en").edited).toBe(true);
    expect(listed.templates.every((t) => t.has_default)).toBe(true);
  });

  it("rejects unknown placeholders and unbalanced brackets, naming the placeholder", () => {
    expect(() => validateTemplate("invoice_created", { title: "Hi {nope}", body: "" })).toThrow(/\{nope\}/);
    expect(() => validateTemplate("payment_received", { title: "x", body: "{balance}" })).not.toThrow();
    expect(() => validateTemplate("invoice_created", { title: "x", body: "[ · {amount}" })).toThrow(/bracket/i);
    expect(() => validateTemplate("invoice_created", { title: "x", body: "{balance}" })).toThrow(/\{balance\}/);
  });

  it("language fallback chain: phone, profile, shop default, English", () => {
    const policy = { notifications: { default_language: "si", allowed_languages: ["en", "si", "ta"] } };
    expect(resolveNotificationLanguage({ deviceLanguage: "ta", userLanguage: "en", policy })).toBe("ta");
    expect(resolveNotificationLanguage({ userLanguage: "en", policy })).toBe("en");
    expect(resolveNotificationLanguage({ policy })).toBe("si");
    expect(resolveNotificationLanguage({ deviceLanguage: "si-Latn", policy })).toBe("si");
    expect(resolveNotificationLanguage({})).toBe("en");
  });
});

describe("template drafts", () => {
  it("renders an unsaved draft in normal and private form and rejects bad placeholders", async () => {
    const draft = { language: "en", title: "Bill {invoice_no}", body: "{customer}[ · {amount}]" };
    const policy = { notifications: { format: { currency: "LKR", date: "dd MMM", time: "24h" } } };
    const normal = await renderDraft({}, "invoice_created", draft, policy);
    const hidden = await renderDraft({}, "invoice_created", draft, policy, { privateMode: true });
    expect(normal.body).toBe("Nimal Perera · LKR 12,000");
    expect(hidden.body).toBe("");
    await expect(renderDraft({}, "invoice_created", { ...draft, body: "{nope}" }, policy)).rejects.toThrow(/\{nope\}/);
  });
});

describe("notifyEvent sends each recipient their own language", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders per phone language and stores each user's in-app copy in their language", async () => {
    const users = [
      { user_id: 1, language: "en", is_active: true, Roles: [{ role_id: 1, role_name: "Admin", hierarchy_level: 100, is_active: true }] },
      { user_id: 2, language: "si", is_active: true, Roles: [{ role_id: 1, role_name: "Admin", hierarchy_level: 100, is_active: true }] },
    ];
    const models = {
      ...makeConfigModels({ push: { events: { invoice_created: { enabled: true } } } }),
      User: {
        findAll: vi.fn(async () => users),
        findByPk: vi.fn(async (id) => users.find((u) => u.user_id === id)),
      },
      Role: {},
      PushPreference: { findAll: vi.fn().mockResolvedValue([]) },
    };
    await notifyEvent(models, "invoice_created", {
      amount: 12000,
      vars: { invoice_no: "7", amount: 12000, customer: "Nimal" },
      now: new Date("2026-11-15T10:00:00Z"),
    });
    const options = mockSendToUsers.mock.calls[0][2];
    const english = await options.render({ user_id: 1 });
    const sinhala = await options.render({ user_id: 2 });
    const tamilPhone = await options.render({ user_id: 1, notification_language: "ta" });
    expect(english.title).toBe("New bill #7");
    expect(sinhala.title).not.toBe(english.title);
    expect(tamilPhone.title).not.toBe(english.title);
    expect(tamilPhone.title).not.toBe(sinhala.title);
    const inApp = Object.fromEntries(mockCreateNotification.mock.calls.map(([, n]) => [n.userId, n.title]));
    expect(inApp[1]).toBe("New bill #7");
    expect(inApp[2]).toBe(sinhala.title);
  });

  it("per-event hide_amount removes amounts for everyone", async () => {
    const models = {
      ...makeConfigModels({ push: { events: { invoice_created: { enabled: true, hide_amount: true } } } }),
      User: {
        findAll: vi.fn(async () => [{ user_id: 1, is_active: true, Roles: [{ role_id: 1, role_name: "Admin", hierarchy_level: 100, is_active: true }] }]),
        findByPk: vi.fn(),
      },
      Role: {},
      PushPreference: { findAll: vi.fn().mockResolvedValue([]) },
    };
    await notifyEvent(models, "invoice_created", {
      amount: 12000,
      vars: { invoice_no: "7", amount: 12000, customer: "Nimal" },
    });
    const options = mockSendToUsers.mock.calls[0][2];
    const text = await options.render({ user_id: 1 });
    expect(`${text.title} ${text.body}`).not.toMatch(/LKR|12,000/);
  });
});

describe("device settings within shop policy (Release 3)", () => {
  const makeDeviceModels = (policy = {}) => ({
    ...makeConfigModels(policy),
    User: { findByPk: vi.fn().mockResolvedValue({ user_id: 5, is_active: true, Roles: [] }) },
    PhoneContact: { destroy: vi.fn() },
    DeviceAuditLog: { create: vi.fn() },
  });
  const makeDevice = () => ({
    operator_device_id: 1,
    user_id: 5,
    status: "ACTIVE",
    update: vi.fn(),
  });

  it("accepts text scale, language and text size inside the shop's limits", async () => {
    const models = makeDeviceModels({ call_screen: { min: 0.9, max: 1.5 } });
    const device = makeDevice();
    await updateDeviceSettings(models, null, device, {
      call_text_scale: 1.3,
      notification_language: "si",
      app_language: "ta",
      app_text_size: "large",
      app_lock_enabled: true,
    });
    expect(device.update).toHaveBeenCalledWith(
      expect.objectContaining({
        call_text_scale: 1.3,
        notification_language: "si",
        app_language: "ta",
        app_text_size: "large",
        app_lock_enabled: true,
      }),
    );
  });

  it("rejects a scale outside bounds, a disallowed language, and everything when the shop locks it", async () => {
    const models = makeDeviceModels({
      call_screen: { min: 0.9, max: 1.5, allow_phone_text_scale: true },
      notifications: { allowed_languages: ["en"] },
      full_app: { require_app_lock: true },
    });
    await expect(updateDeviceSettings(models, null, makeDevice(), { call_text_scale: 1.8 })).rejects.toThrow(/range/);
    await expect(updateDeviceSettings(models, null, makeDevice(), { notification_language: "ta" })).rejects.toThrow(/not allowed/);
    await expect(updateDeviceSettings(models, null, makeDevice(), { app_lock_enabled: false })).rejects.toThrow(/requires the app lock/);

    const locked = makeDeviceModels({ call_screen: { allow_phone_text_scale: false } });
    await expect(updateDeviceSettings(locked, null, makeDevice(), { call_text_scale: 1.2 })).rejects.toThrow(/does not allow/);
  });
});

describe("stale sync warning", () => {
  it("flags a phone whose last brief sync is older than the warn limit", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    const stale = { status: "ACTIVE", is_native_app: true, briefs_synced_at: "2026-11-14T12:00:00Z" };
    const fresh = { status: "ACTIVE", is_native_app: true, briefs_synced_at: "2026-11-16T09:00:00Z" };
    expect(computeDeviceHealthWarnings(stale, now, 24)).toContain("brief_sync_stale");
    expect(computeDeviceHealthWarnings(fresh, now, 24)).not.toContain("brief_sync_stale");
    expect(computeDeviceHealthWarnings(stale, now, 96)).not.toContain("brief_sync_stale");
  });
});
