import { createHash } from "crypto";
import { Op } from "sequelize";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/services/planService.js", () => ({
  getTenantPlan: vi.fn().mockResolvedValue({ features: { phone_assistant: true } }),
}));

vi.mock("../../src/services/userService.js", () => ({
  isUserAdmin: vi.fn().mockReturnValue(false),
  userHasPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/services/devicePushService.js", () => ({
  sendDataPush: vi.fn().mockResolvedValue({ ok: true }),
  sendPushToDevice: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../../src/sockets/emitters.js", () => ({
  emitToTenant: vi.fn(),
  emitToUser: vi.fn(),
}));

import { findPhonesMissingRecordings, getDevicePolicy } from "../../src/services/deviceService.js";
import { uploadDeviceCallRecording } from "../../src/services/callRecordingService.js";
import { updateCollectionsSettings } from "../../src/services/collectionsSettingsService.js";
import { isUserAdmin } from "../../src/services/userService.js";

const makeTenantModels = (customSettings = {}) => ({
  TenantConfig: {
    findOne: vi.fn().mockResolvedValue({
      custom_settings: customSettings,
    }),
  },
  User: {
    findByPk: vi.fn().mockResolvedValue({
      user_id: 7,
      role_id: 2,
      is_active: true,
    }),
  },
  Role: {
    findByPk: vi.fn().mockResolvedValue({ role_id: 2, name: "Cashier" }),
  },
  RolePermission: {
    findAll: vi.fn().mockResolvedValue([]),
  },
  UserPermissionOverride: {
    findAll: vi.fn().mockResolvedValue([]),
  },
  PhoneContact: {
    count: vi.fn().mockResolvedValue(0),
  },
  CallLog: {
    count: vi.fn().mockResolvedValue(0),
  },
  DeviceAuditLog: {
    create: vi.fn().mockResolvedValue({}),
  },
});

const makeDevice = () => ({
  operator_device_id: 11,
  user_id: 7,
  status: "ACTIVE",
  contact_sync_enabled: true,
  contact_sync_mode: "all",
  call_logging_scope: "customers_and_contacts",
  capabilities: {
    signatures: true,
    photos: true,
    push: true,
    caller_brief: true,
    contact_sync: true,
    call_logging: true,
    bill_view: true,
    click_to_call: true,
    full_app: true,
  },
  paired_at: new Date("2026-10-01T08:00:00.000Z"),
  last_seen_at: new Date(),
  update: vi.fn().mockResolvedValue(true),
});

describe("R4-M3 device policy call_recording config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const master = { PlatformConfig: { findAll: vi.fn().mockResolvedValue([]) } };

  it("tells the phone recording is off when the shop never switched it on", async () => {
    const policy = await getDevicePolicy(makeTenantModels({}), "geargrid_shop1", makeDevice(), master);
    expect(policy.call_recording).toEqual({
      enabled: false,
      mobileData: false,
      deleteFromPhoneAfterUpload: false,
      can_set_up: false,
    });
  });

  it("sends the shop's options, and allows the setup step only on an administrator's phone", async () => {
    isUserAdmin.mockReturnValue(true);
    const models = makeTenantModels({
      call_recording: { enabled: true, mobileData: true, deleteFromPhoneAfterUpload: true },
    });
    const policy = await getDevicePolicy(models, "geargrid_shop1", makeDevice(), master);
    expect(policy.call_recording).toEqual({
      enabled: true,
      mobileData: true,
      deleteFromPhoneAfterUpload: true,
      can_set_up: true,
    });
  });
});

describe("R4-M3 phones missing recordings (administrator console warning)", () => {
  const now = new Date("2026-11-25T12:00:00.000Z");
  const phone = { operator_device_id: 11, is_native_app: true, status: "ACTIVE" };
  const shop = (recording, call = null) => ({
    TenantConfig: {
      findOne: vi.fn().mockResolvedValue({ custom_settings: { call_recording: recording } }),
    },
    CallLog: { findOne: vi.fn().mockResolvedValue(call) },
  });
  const unrecorded = { call_id: 5, started_at: "2026-11-23T09:00:00.000Z" };

  it("stays quiet and looks at no calls when recording is off", async () => {
    const models = shop({ enabled: false }, unrecorded);
    const result = await findPhonesMissingRecordings(models, [phone], new Map(), { now });
    expect(result.size).toBe(0);
    expect(models.CallLog.findOne).not.toHaveBeenCalled();
  });

  it("shows the last recording's date when a later answered call has none after a day", async () => {
    const models = shop({ enabled: true }, unrecorded);
    const last = new Map([[11, "2026-11-20T08:00:00.000Z"]]);
    const result = await findPhonesMissingRecordings(models, [phone], last, { now });
    expect(result.get(11)).toBe("2026-11-20T08:00:00.000Z");
    const { where } = models.CallLog.findOne.mock.calls[0][0];
    expect(where.started_at[Op.gt]).toEqual(new Date("2026-11-20T08:00:00.000Z"));
    expect(where.started_at[Op.lte]).toEqual(new Date("2026-11-24T12:00:00.000Z"));
    expect(where.duration_seconds[Op.gte]).toBe(5);
    expect(where.source).toBe("phone");
  });

  it("uses the first unrecorded call's date for a phone that never sent a recording", async () => {
    const result = await findPhonesMissingRecordings(shop({ enabled: true }, unrecorded), [phone], new Map(), { now });
    expect(result.get(11)).toBe("2026-11-23T09:00:00.000Z");
  });

  it("raises nothing without such a call, for recent switch-on, or for web and suspended devices", async () => {
    const none = await findPhonesMissingRecordings(shop({ enabled: true }, null), [phone], new Map(), { now });
    expect(none.size).toBe(0);

    const justOn = shop({ enabled: true, enabledAt: "2026-11-25T08:00:00.000Z" }, unrecorded);
    expect((await findPhonesMissingRecordings(justOn, [phone], new Map(), { now })).size).toBe(0);
    expect(justOn.CallLog.findOne).not.toHaveBeenCalled();

    const others = [
      { ...phone, is_native_app: false },
      { ...phone, status: "SUSPENDED" },
    ];
    const models = shop({ enabled: true }, unrecorded);
    expect((await findPhonesMissingRecordings(models, others, new Map(), { now })).size).toBe(0);
  });

  it("records when recording was switched on, and keeps that date on later saves", async () => {
    const row = { custom_settings: {} };
    row.update = vi.fn(async (patch) => Object.assign(row, patch));
    const models = { TenantConfig: { findOne: vi.fn().mockResolvedValue(row) } };

    const first = await updateCollectionsSettings(models, { call_recording: { enabled: true } });
    expect(first.call_recording.enabledAt).toEqual(expect.any(String));
    const again = await updateCollectionsSettings(models, {
      call_recording: { enabled: true, mobileData: true },
    });
    expect(again.call_recording.enabledAt).toBe(first.call_recording.enabledAt);
  });
});

describe("R4-M3 recording upload retries", () => {
  const audio = (text) => ({ originalname: "call.m4a", mimetype: "audio/mp4", size: text.length, buffer: Buffer.from(text) });
  const setup = (existing) => {
    const storage = { putObject: vi.fn(), deleteObject: vi.fn().mockResolvedValue(true) };
    const models = {
      TenantConfig: {
        findOne: vi.fn().mockResolvedValue({ custom_settings: { call_recording: { enabled: true } } }),
      },
      CallLog: { findOne: vi.fn().mockResolvedValue({ call_id: 300, duration_seconds: 20 }) },
      CallRecording: { findOne: vi.fn().mockResolvedValue(existing), create: vi.fn() },
    };
    return { storage, models };
  };
  const stored = (text, extra = {}) => {
    const row = {
      recording_id: 1,
      call_id: 300,
      storage_key: "t1/300/old.m4a",
      mime_type: "audio/mp4",
      bytes: text.length,
      sha256: createHash("sha256").update(text).digest("hex"),
      uploaded_at: new Date("2026-11-25T08:00:00.000Z"),
      dispute_hold: false,
      ...extra,
    };
    row.update = vi.fn(async (patch) => Object.assign(row, patch));
    return row;
  };

  it("answers a repeated upload without storing the audio again", async () => {
    const { storage, models } = setup(stored("same-audio"));
    const result = await uploadDeviceCallRecording(models, "t1", { operator_device_id: 2 }, "c-300", audio("same-audio"), {}, { storage });
    expect(result.recording_id).toBe(1);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("removes the replaced audio, unless it is under a dispute hold", async () => {
    const plain = setup(stored("old-audio"));
    await uploadDeviceCallRecording(plain.models, "t1", { operator_device_id: 2 }, "c-300", audio("new-audio"), {}, { storage: plain.storage });
    expect(plain.storage.deleteObject).toHaveBeenCalledWith({ key: "t1/300/old.m4a" });

    const held = setup(stored("old-audio", { dispute_hold: true }));
    await uploadDeviceCallRecording(held.models, "t1", { operator_device_id: 2 }, "c-300", audio("new-audio"), {}, { storage: held.storage });
    expect(held.storage.deleteObject).not.toHaveBeenCalled();
  });
});
