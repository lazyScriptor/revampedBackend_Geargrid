import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeleteDeviceCallsContract,
  DeleteDeviceContactsContract,
  GetDevicePolicyContract,
} from "@geargrid/contracts";

const mockSendDataPush = vi.fn().mockResolvedValue({ sent: true });
const mockEmitToTenant = vi.fn();
const mockGetTenantPlan = vi.fn().mockResolvedValue({
  plan_code: "pro",
  features: { phone_assistant: true },
});

vi.mock("../../src/services/devicePushService.js", async () => {
  const actual = await vi.importActual("../../src/services/devicePushService.js");
  return {
    ...actual,
    sendDataPush: (...args) => mockSendDataPush(...args),
  };
});

vi.mock("../../src/sockets/emitters.js", () => ({
  emitToTenant: (...args) => mockEmitToTenant(...args),
}));

vi.mock("../../src/services/planService.js", () => ({
  getTenantPlan: (...args) => mockGetTenantPlan(...args),
}));

const {
  getPhoneAssistantPolicy,
  updatePhoneAssistantPolicy,
} = await import("../../src/services/phoneAssistantPolicyService.js");
const {
  updateShopDevice,
  getDevicePolicy,
  updateDeviceSettings,
} = await import("../../src/services/deviceService.js");
const {
  syncDeviceContacts,
  deleteDeviceContacts,
} = await import("../../src/services/phoneContactService.js");
const {
  recordDeviceCall,
  deleteDeviceCalls,
  purgeExpiredCallLogs,
} = await import("../../src/services/callLogService.js");

const makePolicyStoreModels = (initialPolicy = null, extra = {}) => {
  let configRow = initialPolicy
    ? {
        custom_settings: { phone_assistant: initialPolicy },
      }
    : null;
  if (configRow) {
    configRow.update = vi.fn(async ({ custom_settings }) => {
      configRow.custom_settings = custom_settings;
      return configRow;
    });
  }
  const auditLogs = [];
  const TenantConfig = {
    findOne: vi.fn(async () => configRow),
    create: vi.fn(async ({ custom_settings }) => {
      configRow = {
        custom_settings,
        update: vi.fn(async (patch) => {
          configRow.custom_settings = patch.custom_settings;
          return configRow;
        }),
      };
      return configRow;
    }),
  };

  return {
    TenantConfig,
    auditLogs,
    OperatorDevice: {
      findAll: vi.fn().mockResolvedValue([]),
      findByPk: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue([0]),
    },
    User: {
      findByPk: vi.fn().mockResolvedValue({
        id: 7,
        first_name: "Nimal",
        last_name: "Silva",
        email: "nimal@shop.test",
        is_active: true,
        Role: { role_id: 2, role_name: "cashier", hierarchy_level: 40 },
      }),
    },
    RolePermission: { findAll: vi.fn().mockResolvedValue([]) },
    Permission: { findAll: vi.fn().mockResolvedValue([]) },
    DeviceAuditLog: {
      create: vi.fn(async (row) => {
        auditLogs.push(row);
        return row;
      }),
    },
    PhoneContact: {
      count: vi.fn().mockResolvedValue(0),
      destroy: vi.fn().mockResolvedValue(0),
      findAll: vi.fn().mockResolvedValue([]),
      bulkCreate: vi.fn(async (rows) => rows),
      create: vi.fn(async (row) => row),
    },
    CallLog: {
      count: vi.fn().mockResolvedValue(0),
      destroy: vi.fn().mockResolvedValue(0),
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn(async (row) => ({ call_id: 501, ...row, get: () => row })),
    },
    CustomerPhone: {
      findAll: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
    },
    ...extra,
  };
};

const makeDevice = (overrides = {}) => {
  const row = {
    operator_device_id: 12,
    user_id: 7,
    device_id: "dev-12",
    device_label: "Counter Phone",
    status: "ACTIVE",
    capabilities: { caller_brief: true, contact_sync: true, call_logging: true, push_notifications: true },
    brief_profile_id: null,
    muted: false,
    contact_sync_enabled: true,
    contact_sync_mode: "all",
    call_logging_scope: "all",
    sim_filter: null,
    contacts_synced_at: new Date("2026-11-15T09:00:00Z"),
    paired_at: new Date("2026-10-01T08:00:00Z"),
    last_seen_at: new Date("2026-11-15T10:00:00Z"),
    push_token: "fcm-token-12",
    ...overrides,
  };
  row.update = vi.fn(async (patch) => {
    Object.assign(row, patch);
    return row;
  });
  return row;
};

describe("Release 2 Slice 3 — Contact sync modes, Call logging controls & Device privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. validates and persists contact_sync & call_logging shop policy, rejecting invalid bounds", async () => {
    const models = makePolicyStoreModels();

    await expect(
      updatePhoneAssistantPolicy(models, {
        contact_sync: { allowed_modes: ["bogus_mode"] },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      updatePhoneAssistantPolicy(models, {
        call_logging: { retention_days: 0 },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      updatePhoneAssistantPolicy(models, {
        call_logging: { allowed_scopes: ["invalid_scope"] },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const { policy } = await updatePhoneAssistantPolicy(models, {
      contact_sync: {
        allowed_modes: ["off", "selected_labels"],
      },
      call_logging: {
        allowed_scopes: ["off", "customers_only"],
        store_unknown_numbers: false,
        business_hours_only: true,
        business_hours: { from: "08:30", to: "17:30" },
        retention_days: 90,
      },
    });

    expect(policy.contact_sync).toEqual({
      allowed_modes: ["off", "selected_labels"],
      fields: ["name_and_number"],
    });
    expect(policy.call_logging).toEqual({
      allowed_scopes: ["off", "customers_only"],
      store_unknown_numbers: false,
      business_hours_only: true,
      business_hours: { from: "08:30", to: "17:30" },
      retention_days: 90,
    });

    const loaded = await getPhoneAssistantPolicy(models);
    expect(loaded.policy.call_logging.retention_days).toBe(90);
    expect(loaded.policy.contact_sync.allowed_modes).toEqual(["off", "selected_labels"]);
  });

  it("2. enforces allowed_modes/allowed_scopes on updateDeviceSettings & updateShopDevice, and wipes synced contacts on 'off'", async () => {
    const models = makePolicyStoreModels({
      contact_sync: { allowed_modes: ["off", "selected_labels"], fields: ["name_and_number"] },
      call_logging: {
        allowed_scopes: ["off", "customers_only"],
        store_unknown_numbers: true,
        business_hours_only: false,
        business_hours: { from: "08:00", to: "18:00" },
        retention_days: 180,
      },
    });
    const device = makeDevice({
      contact_sync_mode: "selected_labels",
      contact_sync_enabled: true,
      call_logging_scope: "customers_only",
    });
    models.OperatorDevice.findByPk.mockResolvedValue(device);
    models.PhoneContact.destroy.mockResolvedValue(14);

    await expect(
      updateDeviceSettings(models, "tenant_a", device, {
        contact_sync_mode: "all",
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "policy_disallowed" });

    await expect(
      updateShopDevice(models, device.operator_device_id, {
        call_logging_scope: "all",
      }, { userId: 1 }),
    ).rejects.toMatchObject({ statusCode: 400, code: "policy_disallowed" });

    const res = await updateDeviceSettings(models, "tenant_a", device, {
      contact_sync_mode: "off",
      call_logging_scope: "off",
      sim_filter: "SIM 1",
    });

    expect(res.contact_sync_mode).toBe("off");
    expect(res.call_logging_scope).toBe("off");
    expect(res.sim_filter).toBe("SIM 1");
    expect(device.contact_sync_enabled).toBe(false);
    expect(device.contacts_synced_at).toBeNull();
    expect(models.PhoneContact.destroy).toHaveBeenCalledWith({
      where: { operator_device_id: device.operator_device_id },
    });
  });

  it("3. getDevicePolicy returns C.5 transparency counts & policy details conforming to contract", async () => {
    const models = makePolicyStoreModels({
      contact_sync: { allowed_modes: ["off", "selected_labels", "all"], fields: ["name_and_number"] },
      call_logging: {
        allowed_scopes: ["off", "customers_and_contacts", "all"],
        store_unknown_numbers: false,
        business_hours_only: true,
        business_hours: { from: "08:00", to: "18:00" },
        retention_days: 120,
      },
    });
    models.PhoneContact.count.mockResolvedValue(48);
    models.CallLog.count.mockResolvedValue(19);
    const device = makeDevice();

    const policyPayload = await getDevicePolicy(models, "tenant_a", device);

    expect(policyPayload.contact_count).toBe(48);
    expect(policyPayload.calls_logged_this_month).toBe(19);
    expect(policyPayload.contact_sync_policy?.allowed_modes).toEqual([
      "off",
      "selected_labels",
      "all",
    ]);
    expect(policyPayload.call_logging_policy?.retention_days).toBe(120);
    expect(policyPayload.paired_at).toBe("2026-10-01T08:00:00.000Z");
    expect(policyPayload.consented_capabilities).toEqual({
      signatures: true,
      photos: true,
      push: true,
      caller_brief: true,
      contact_sync: true,
      call_logging: true,
      bill_view: true,
      click_to_call: true,
      full_app: true,
    });

    const parsed = GetDevicePolicyContract.response.safeParse({
      status: "success",
      data: policyPayload,
    });
    expect(parsed.success).toBe(true);
  });

  it("4. syncDeviceContacts honors contact_sync_mode ('selected_labels' allowed, 'off' rejected)", async () => {
    const models = makePolicyStoreModels();
    const offDevice = makeDevice({
      contact_sync_enabled: false,
      contact_sync_mode: "off",
    });

    await expect(
      syncDeviceContacts(models, offDevice, {
        upserts: [{ key: "c1", name: "Saman", phones: ["0771112223"] }],
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const labeledDevice = makeDevice({
      contact_sync_enabled: false,
      contact_sync_mode: "selected_labels",
    });
    const res = await syncDeviceContacts(models, labeledDevice, {
      upserts: [{ key: "c1", name: "Saman", phones: ["0771112223"] }],
    });
    expect(res.accepted).toBe(1);
    expect(models.PhoneContact.bulkCreate).toHaveBeenCalledTimes(1);
  });

  it("5. recordDeviceCall respects SIM filter, Colombo business hours, and unknown-number masking", async () => {
    const models = makePolicyStoreModels({
      call_logging: {
        allowed_scopes: ["all"],
        store_unknown_numbers: false,
        business_hours_only: true,
        business_hours: { from: "08:00", to: "18:00" },
        retention_days: 180,
      },
    });
    models.sequelize = { transaction: vi.fn(async (cb) => cb({})) };

    const deviceSim1 = makeDevice({ sim_filter: "SIM 1", call_logging_scope: "all" });

    // Outside business hours: 16:30 UTC = 22:00 Asia/Colombo
    const afterHours = await recordDeviceCall(models, "tenant_a", deviceSim1, {
      client_call_id: "call-after-hours",
      raw_number: "0771234567",
      direction: "INCOMING",
      state: "ENDED",
      started_at: "2026-11-15T16:30:00.000Z",
      sim_label: "SIM 1",
    });
    expect(afterHours.skipped).toBe(true);
    expect(models.CallLog.create).not.toHaveBeenCalled();

    // Wrong SIM during business hours: 04:30 UTC = 10:00 Asia/Colombo
    const wrongSim = await recordDeviceCall(models, "tenant_a", deviceSim1, {
      client_call_id: "call-wrong-sim",
      raw_number: "0771234567",
      direction: "INCOMING",
      state: "ENDED",
      started_at: "2026-11-15T04:30:00.000Z",
      sim_label: "SIM 2",
    });
    expect(wrongSim.skipped).toBe(true);
    expect(models.CallLog.create).not.toHaveBeenCalled();

    // Matching SIM + business hours + unknown caller with store_unknown_numbers=false -> masked
    const maskedCall = await recordDeviceCall(models, "tenant_a", deviceSim1, {
      client_call_id: "call-masked-unknown",
      raw_number: "0779984567",
      direction: "INCOMING",
      state: "RINGING",
      started_at: "2026-11-15T04:30:00.000Z",
      sim_label: "SIM 1",
    }, { now: new Date("2026-11-15T04:30:05.000Z") });

    expect(maskedCall.skipped).toBeUndefined();
    expect(models.CallLog.create).toHaveBeenCalledTimes(1);
    const createdArg = models.CallLog.create.mock.calls[0][0];
    expect(createdArg.phone_e164).toBeNull();
    expect(createdArg.raw_number).toBe("****4567");
    expect(createdArg.number_masked).toBe(true);
    expect(createdArg.sim_label).toBe("SIM 1");
  });

  it("6 & 7. deleteDeviceContacts and deleteDeviceCalls remove records, clear timestamps, write audit logs, and match contracts", async () => {
    const models = makePolicyStoreModels();
    models.PhoneContact.destroy.mockResolvedValue(23);
    models.CallLog.destroy.mockResolvedValue(11);
    const device = makeDevice();

    const contactsRes = await deleteDeviceContacts(models, device);
    expect(contactsRes).toEqual({ deleted: 23 });
    expect(device.contacts_synced_at).toBeNull();
    expect(
      DeleteDeviceContactsContract.response.safeParse({ status: "success", data: contactsRes }).success,
    ).toBe(true);

    const callsRes = await deleteDeviceCalls(models, device);
    expect(callsRes).toEqual({ deleted: 11 });
    expect(
      DeleteDeviceCallsContract.response.safeParse({ status: "success", data: callsRes }).success,
    ).toBe(true);

    expect(models.auditLogs.map((a) => a.action)).toEqual([
      "contacts_deleted",
      "calls_deleted",
    ]);
  });

  it("8. purgeExpiredCallLogs deletes logs older than configured retention_days", async () => {
    const models = makePolicyStoreModels({
      call_logging: {
        allowed_scopes: ["all"],
        store_unknown_numbers: true,
        business_hours_only: false,
        business_hours: { from: "08:00", to: "18:00" },
        retention_days: 90,
      },
    });
    models.CallLog.destroy.mockResolvedValue(7);

    const now = new Date("2026-11-15T12:00:00.000Z");
    const result = await purgeExpiredCallLogs(models, { now });

    expect(result).toEqual({ deleted: 7, retention_days: 90 });
    expect(models.CallLog.destroy).toHaveBeenCalledTimes(1);
    const whereClause = models.CallLog.destroy.mock.calls[0][0].where;
    expect(whereClause.started_at).toBeDefined();
  });
});
