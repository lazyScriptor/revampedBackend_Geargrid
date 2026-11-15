import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearTenantStatusCache } from "../../src/utils/tenantStatusCache.js";

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const state = vi.hoisted(() => ({
  masterModels: null,
  tenantModelsByDb: new Map(),
  mockSend: vi.fn().mockResolvedValue("msg-id-1"),
  mockEmitTenant: vi.fn(),
  currentPlan: { tier: "Enterprise", features: { phone_assistant: true } },
  protectUser: { userId: 1, tenantDbName: "geargrid_shop1" },
}));

vi.mock("firebase-admin/app", () => ({
  cert: vi.fn((sa) => sa),
  getApp: vi.fn(() => ({ name: "mock" })),
  getApps: vi.fn(() => [{ name: "mock" }]),
  initializeApp: vi.fn(() => ({ name: "mock" })),
}));
vi.mock("firebase-admin/messaging", () => ({
  getMessaging: vi.fn(() => ({ send: state.mockSend })),
}));

vi.mock("../../src/models/master/index.js", () => ({
  getMasterModels: () => state.masterModels,
  initMasterModels: () => ({ GlobalUser: { findOne: vi.fn(), update: vi.fn(), destroy: vi.fn() } }),
}));

vi.mock("../../src/config/database.js", () => ({
  getCachedTenantConnection: (dbName) => ({ dbName }),
  masterSequelize: { query: vi.fn() },
}));

vi.mock("../../src/models/index.js", () => ({
  initTenantModels: (conn) => state.tenantModelsByDb.get(conn?.dbName || "geargrid_shop1"),
}));

vi.mock("../../src/services/planService.js", () => ({
  getTenantPlan: vi.fn(async () => state.currentPlan),
}));

vi.mock("../../src/sockets/emitters.js", () => ({
  emitToTenant: (...args) => state.mockEmitTenant(...args),
  emitToUser: vi.fn(),
}));

vi.mock("../../src/middlewares/authMiddleware.js", () => ({
  protect: (req, _res, next) => {
    req.user = state.protectUser;
    next();
  },
}));

vi.mock("../../src/middlewares/planMiddleware.js", () => ({
  requireFeature: () => (_req, _res, next) => next(),
}));

const {
  claimPairingCode,
  getPairingCodePreview,
  registerDevice,
  rotateDeviceToken,
  setDeviceStatus,
  verifyDevicePublicAccess,
  listMyDevices,
} = await import("../../src/services/deviceService.js");
const { resolveDeviceCapabilities } = await import(
  "../../src/services/phoneAssistantPolicyService.js"
);
const { updateUserStatus, deleteUser } = await import("../../src/services/userService.js");
const { default: deviceAppRoutes } = await import("../../src/routes/deviceAppRoutes.js");
const { default: phoneAssistantRoutes } = await import("../../src/routes/phoneAssistantRoutes.js");
const { default: errorHandler } = await import("../../src/middlewares/errorHandler.js");

const makeDeviceRow = (initial = {}) => {
  const row = {
    operator_device_id: 1,
    user_id: 10,
    device_id: "dev-partb-1234",
    device_label: "Test Phone",
    status: "ACTIVE",
    capabilities: null,
    reported_state: null,
    contact_sync_enabled: false,
    contact_sync_mode: "off",
    call_logging_scope: "customers_and_contacts",
    is_native_app: true,
    paired_at: new Date("2026-11-15T10:00:00.000Z"),
    last_seen_at: new Date(),
    ...initial,
    update: vi.fn(async (patch) => {
      Object.assign(row, patch);
      return row;
    }),
  };
  return row;
};

describe("GearGrid Phone Assistant — Release 2 Part B (Device Trust)", () => {
  beforeEach(() => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: "test",
      client_email: "test@example.com",
      private_key: "key",
    });
    clearTenantStatusCache();
    vi.clearAllMocks();
    state.currentPlan = { tier: "Enterprise", features: { phone_assistant: true } };
    state.protectUser = { userId: 1, tenantDbName: "geargrid_shop1" };
    state.masterModels = {
      Tenant: {
        findOne: vi.fn().mockResolvedValue({
          tenant_id: 1,
          db_name: "geargrid_shop1",
          subscription_status: "Active",
          feature_flags: null,
        }),
        findByPk: vi.fn().mockResolvedValue({
          tenant_id: 1,
          db_name: "geargrid_shop1",
          display_name: "Lanka Rentals",
          subscription_status: "Active",
          feature_flags: null,
        }),
        findAll: vi.fn().mockResolvedValue([
          {
            tenant_id: 1,
            db_name: "geargrid_shop1",
            display_name: "Lanka Rentals",
            subscription_status: "Active",
            feature_flags: null,
          },
        ]),
      },
      DevicePairingCode: {
        findOne: vi.fn(),
      },
      DeviceRegistry: {
        findOne: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(true),
        destroy: vi.fn().mockResolvedValue(1),
      },
    };
  });

  it("B.1: approval_mode controls PENDING vs ACTIVE on claimPairingCode & preview returns transparency details", async () => {
    let customSettings = {
      phone_assistant: {
        approval_mode: "auto_approve_admin_phones",
        offline_wipe_days: 7,
        auto_suspend_days: 30,
      },
    };
    const auditLogs = [];
    const createdDevices = [];
    const adminUser = {
      user_id: 1,
      first_name: "Boss",
      last_name: "Admin",
      username: "admin",
      is_active: true,
      Roles: [{ role_id: 1, role_name: "Admin", hierarchy_level: 100, is_active: true, Permissions: [] }],
    };
    const staffUser = {
      user_id: 2,
      first_name: "Nimal",
      last_name: "Cashier",
      username: "nimal",
      is_active: true,
      Roles: [{ role_id: 2, role_name: "Cashier", hierarchy_level: 20, is_active: true, Permissions: [] }],
    };

    const tenantModels = {
      TenantConfig: {
        findOne: vi.fn(async () => ({
          business_display_name: "Lanka Rentals",
          custom_settings: customSettings,
        })),
      },
      User: {
        findByPk: vi.fn(async (id) => (id === 1 ? adminUser : staffUser)),
      },
      Role: {},
      Permission: {},
      UserPermissionOverride: { findAll: vi.fn(async () => []) },
      OperatorDevice: {
        findOne: vi.fn(async () => null),
        create: vi.fn(async (payload) => {
          const row = makeDeviceRow({
            operator_device_id: createdDevices.length + 1,
            ...payload,
          });
          createdDevices.push(row);
          return row;
        }),
      },
      DeviceAuditLog: {
        create: vi.fn(async (entry) => {
          auditLogs.push(entry);
          return entry;
        }),
      },
    };
    state.tenantModelsByDb.set("geargrid_shop1", tenantModels);

    // Non-admin phone under auto_approve_admin_phones -> preview says will_require_approval: true
    state.masterModels.DevicePairingCode.findOne.mockResolvedValue({
      pairing_code_id: 11,
      code: "AAA-222",
      tenant_id: 1,
      user_id: 2,
      status: "PENDING",
      expires_at: new Date(Date.now() + 60_000),
      update: vi.fn(async () => true),
    });

    const preview = await getPairingCodePreview(state.masterModels, { code: "aaa-222" });
    expect(preview.shop_name).toBe("Lanka Rentals");
    expect(preview.staff_name).toBe("Nimal Cashier");
    expect(preview.will_require_approval).toBe(true);
    expect(preview.requested_capabilities.caller_brief).toBe(true);

    const staffClaim = await claimPairingCode(state.masterModels, {
      code: "AAA-222",
      device_id: "phone-staff-001",
      device_label: "Nimal Phone",
      device_model: "Samsung A15",
      os_version: "14",
      app_version: "1.1.0",
    });
    expect(staffClaim.status).toBe("PENDING");
    expect(staffClaim.effective_capabilities.signatures).toBe(true);
    expect(staffClaim.effective_capabilities.photos).toBe(true);
    expect(staffClaim.effective_capabilities.caller_brief).toBe(false);
    expect(state.mockEmitTenant).toHaveBeenCalledWith(
      "geargrid_shop1",
      "device:pending",
      expect.objectContaining({ user_id: 2 }),
    );
    expect(auditLogs[0]).toMatchObject({ action: "paired", detail: expect.objectContaining({ status: "PENDING" }) });

    // Admin phone under auto_approve_admin_phones -> ACTIVE immediately
    state.masterModels.DevicePairingCode.findOne.mockResolvedValue({
      pairing_code_id: 12,
      code: "BBB-333",
      tenant_id: 1,
      user_id: 1,
      status: "PENDING",
      expires_at: new Date(Date.now() + 60_000),
      update: vi.fn(async () => true),
    });
    const adminClaim = await claimPairingCode(state.masterModels, {
      code: "BBB-333",
      device_id: "phone-admin-001",
      device_label: "Admin Phone",
    });
    expect(adminClaim.status).toBe("ACTIVE");
    expect(adminClaim.effective_capabilities.caller_brief).toBe(true);

    // admin_approves_all makes even admin phone PENDING
    customSettings = { phone_assistant: { approval_mode: "admin_approves_all" } };
    state.masterModels.DevicePairingCode.findOne.mockResolvedValue({
      pairing_code_id: 13,
      code: "CCC-444",
      tenant_id: 1,
      user_id: 1,
      status: "PENDING",
      expires_at: new Date(Date.now() + 60_000),
      update: vi.fn(async () => true),
    });
    const strictClaim = await claimPairingCode(state.masterModels, {
      code: "CCC-444",
      device_id: "phone-admin-002",
    });
    expect(strictClaim.status).toBe("PENDING");

    // auto_approve_all makes non-admin phone ACTIVE
    customSettings = { phone_assistant: { approval_mode: "auto_approve_all" } };
    state.masterModels.DevicePairingCode.findOne.mockResolvedValue({
      pairing_code_id: 14,
      code: "DDD-555",
      tenant_id: 1,
      user_id: 2,
      status: "PENDING",
      expires_at: new Date(Date.now() + 60_000),
      update: vi.fn(async () => true),
    });
    const openClaim = await claimPairingCode(state.masterModels, {
      code: "DDD-555",
      device_id: "phone-staff-002",
    });
    expect(openClaim.status).toBe("ACTIVE");
  });

  it("B.1 & B.5: PENDING device allows signatures & /device/register + token rotation (with 24h prev_token_hash), but blocks briefs/contacts/calls", async () => {
    const token1 = "t1".repeat(32);
    const device = makeDeviceRow({
      operator_device_id: 7,
      user_id: 10,
      device_id: "dev-pending-0001",
      status: "PENDING",
      token_hash: sha256(token1),
    });
    const auditLogs = [];
    const tenantModels = {
      TenantConfig: { findOne: vi.fn(async () => ({ custom_settings: {} })) },
      User: {
        findByPk: vi.fn(async () => ({
          user_id: 10,
          is_active: true,
          Roles: [{ role_id: 1, role_name: "Admin", hierarchy_level: 100, is_active: true, Permissions: [] }],
        })),
      },
      Role: {},
      Permission: {},
      UserPermissionOverride: { findAll: vi.fn(async () => []) },
      OperatorDevice: { findOne: vi.fn(async () => device) },
      DeviceAuditLog: { create: vi.fn(async (e) => auditLogs.push(e)) },
      Customer: { findAll: vi.fn(async () => []) },
    };
    state.tenantModelsByDb.set("geargrid_shop1", tenantModels);

    // Public signature/photo check succeeds while PENDING
    const pubFound = await verifyDevicePublicAccess(
      state.masterModels,
      "dev-pending-0001",
      token1,
      { isNativeClient: true },
    );
    expect(pubFound.device.status).toBe("PENDING");

    const app = express();
    app.use(express.json());
    app.use("/api/device", deviceAppRoutes);
    app.use(errorHandler);

    // /device/register allowed while PENDING
    const regRes = await request(app)
      .post("/api/device/register")
      .set("x-device-id", "dev-pending-0001")
      .set("x-tenant-db", "geargrid_shop1")
      .set("Authorization", `Bearer ${token1}`)
      .send({
        app_version: "1.2.0",
        device_model: "Pixel 7",
        os_version: "14",
        reported_state: { battery_optimization_exempt: false, notifications_permission: true },
      });
    expect(regRes.status).toBe(200);
    expect(regRes.body.data.device_status).toBe("PENDING");
    expect(regRes.body.data.effective_capabilities.signatures).toBe(true);
    expect(regRes.body.data.effective_capabilities.caller_brief).toBe(false);
    expect(regRes.body.data.capability_reasons.caller_brief).toBe("device_pending");

    // /device/briefs blocked with 403 device_pending
    const briefsRes = await request(app)
      .get("/api/device/briefs")
      .set("x-device-id", "dev-pending-0001")
      .set("x-tenant-db", "geargrid_shop1")
      .set("Authorization", `Bearer ${token1}`);
    expect(briefsRes.status).toBe(403);
    expect(briefsRes.body.code).toBe("device_pending");

    // Token rotation returns new token and keeps token1 valid during 24h grace window
    const rotRes = await request(app)
      .post("/api/device/token/rotate")
      .set("x-device-id", "dev-pending-0001")
      .set("x-tenant-db", "geargrid_shop1")
      .set("Authorization", `Bearer ${token1}`)
      .send({});
    expect(rotRes.status).toBe(200);
    const token2 = rotRes.body.data.device_token;
    expect(token2).toMatch(/^[a-f0-9]{64}$/);
    expect(token2).not.toBe(token1);
    expect(auditLogs.some((a) => a.action === "token_rotated")).toBe(true);

    // Old token1 STILL authenticates inside 24h grace window
    const regOld = await request(app)
      .post("/api/device/register")
      .set("x-device-id", "dev-pending-0001")
      .set("x-tenant-db", "geargrid_shop1")
      .set("Authorization", `Bearer ${token1}`)
      .send({ app_version: "1.2.0" });
    expect(regOld.status).toBe(200);

    // New token2 also authenticates
    const regNew = await request(app)
      .post("/api/device/register")
      .set("x-device-id", "dev-pending-0001")
      .set("x-tenant-db", "geargrid_shop1")
      .set("Authorization", `Bearer ${token2}`)
      .send({ app_version: "1.2.0" });
    expect(regNew.status).toBe(200);

    // Unknown token fails with 401
    const regBad = await request(app)
      .post("/api/device/register")
      .set("x-device-id", "dev-pending-0001")
      .set("x-tenant-db", "geargrid_shop1")
      .set("Authorization", "Bearer deadbeef")
      .send({ app_version: "1.2.0" });
    expect(regBad.status).toBe(401);
  });

  it("B.2: resolveDeviceCapabilities computes exact blocking reasons in precedence order", () => {
    const baseDevice = {
      status: "ACTIVE",
      capabilities: {
        signatures: true,
        photos: true,
        caller_brief: true,
        bill_view: true,
        push: true,
        contact_sync: true,
        call_logging: true,
        click_to_call: true,
      },
      contact_sync_enabled: true,
      contact_sync_mode: "all",
      call_logging_scope: "customers_and_contacts",
      reported_state: {
        call_screening_role: true,
        overlay_permission: true,
        notifications_permission: true,
        contacts_permission: true,
        call_log_permission: true,
      },
    };
    const res1 = resolveDeviceCapabilities({
      device: {
        ...baseDevice,
        contact_sync_enabled: false,
        contact_sync_mode: "off",
        reported_state: { ...baseDevice.reported_state, notifications_permission: false },
      },
      isAdmin: false,
      permissionSet: new Set(["calls:view"]), // missing invoice:view
      policy: {
        capabilities: {
          signatures: true,
          photos: true,
          caller_brief: true,
          bill_view: true,
          push: true,
          contact_sync: true,
          call_logging: true,
          click_to_call: false, // blocked by shop_policy
        },
      },
      planHasPhoneAssistant: true,
    });

    expect(res1.effective.signatures).toBe(true);
    expect(res1.reasons.signatures).toBeNull();
    expect(res1.effective.caller_brief).toBe(true);
    expect(res1.effective.bill_view).toBe(false);
    expect(res1.reasons.bill_view).toBe("role");
    expect(res1.effective.contact_sync).toBe(false);
    expect(res1.reasons.contact_sync).toBe("phone_switch");
    expect(res1.effective.push).toBe(false);
    expect(res1.reasons.push).toBe("os_permission");
    expect(res1.effective.click_to_call).toBe(false);
    expect(res1.reasons.click_to_call).toBe("shop_policy");

    const res2 = resolveDeviceCapabilities({
      device: { ...baseDevice, capabilities: { ...baseDevice.capabilities, caller_brief: false } },
      isAdmin: true,
      permissionSet: new Set(),
      policy: { capabilities: { signatures: true, photos: true, caller_brief: true } },
      planHasPhoneAssistant: false,
    });
    expect(res2.reasons.bill_view).toBe("plan");
    expect(res2.reasons.signatures).toBeNull();

    const res3 = resolveDeviceCapabilities({
      device: { ...baseDevice, capabilities: { ...baseDevice.capabilities, caller_brief: false } },
      isAdmin: true,
      permissionSet: new Set(),
      policy: { capabilities: { signatures: true, photos: true, caller_brief: true } },
      planHasPhoneAssistant: true,
    });
    expect(res3.reasons.caller_brief).toBe("not_granted");
  });

  it("B.4 & user lifecycle: suspend, resume, revoke keep audit trail, and user deactivation suspends phones", async () => {
    const token = "s1".repeat(32);
    const device = makeDeviceRow({
      operator_device_id: 20,
      user_id: 5,
      device_id: "dev-lifecycle-20",
      status: "ACTIVE",
      push_token: "fcm-life-20",
      token_hash: sha256(token),
    });
    const auditLogs = [];
    const phoneDestroy = vi.fn(async () => 4);
    const userRow = {
      user_id: 5,
      is_active: true,
      Roles: [{ role_id: 2, role_name: "Cashier", hierarchy_level: 20, is_active: true, Permissions: [] }],
      save: vi.fn(async () => userRow),
    };

    const tenantModels = {
      TenantConfig: { findOne: vi.fn(async () => ({ custom_settings: {} })) },
      User: {
        findByPk: vi.fn(async () => userRow),
      },
      Role: {},
      Permission: {},
      UserPermissionOverride: { findAll: vi.fn(async () => []) },
      OperatorDevice: {
        findByPk: vi.fn(async () => device),
        findAll: vi.fn(async () => [device]),
        findOne: vi.fn(async () => device),
        update: vi.fn(async (patch) => Object.assign(device, patch)),
      },
      PhoneContact: { destroy: phoneDestroy },
      DeviceAuditLog: {
        create: vi.fn(async (entry) => {
          auditLogs.push(entry);
          return entry;
        }),
      },
    };
    state.tenantModelsByDb.set("geargrid_shop1", tenantModels);

    // Deactivating user suspends device (does not revoke!)
    await updateUserStatus(tenantModels, 5, false);
    expect(device.status).toBe("SUSPENDED");
    expect(device.token_hash).toBe(sha256(token));
    expect(state.mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "device_suspended" }) }),
    );
    expect(auditLogs[0].action).toBe("suspended");

    // Suspended device is blocked on public endpoints too (403 device_suspended)
    await expect(
      verifyDevicePublicAccess(state.masterModels, "dev-lifecycle-20", token, { isNativeClient: true }),
    ).rejects.toMatchObject({ statusCode: 403, code: "device_suspended" });

    // Admin resumes device
    userRow.is_active = true;
    await setDeviceStatus(tenantModels, 20, "ACTIVE", { userId: 1 }, "back_from_leave", state.masterModels);
    expect(device.status).toBe("ACTIVE");
    expect(auditLogs[1].action).toBe("resumed");
    expect(state.mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "device_resumed" }) }),
    );

    // Revoking device clears tokens, deletes contacts + registry, sends push, keeps row for audit, hides from listMyDevices
    await setDeviceStatus(tenantModels, 20, "REVOKED", { userId: 1 }, "lost_phone", state.masterModels);
    expect(device.status).toBe("REVOKED");
    expect(device.token_hash).toBeNull();
    expect(device.push_token).toBeNull();
    expect(phoneDestroy).toHaveBeenCalled();
    expect(state.masterModels.DeviceRegistry.destroy).toHaveBeenCalledWith({
      where: { device_id: "dev-lifecycle-20" },
    });
    expect(auditLogs[2].action).toBe("revoked");

    const myList = await listMyDevices(tenantModels, 5, "geargrid_shop1");
    expect(myList.devices).toHaveLength(0);

    // Deleting user calls revokeUserDevices
    const user2 = {
      user_id: 6,
      is_active: true,
      Roles: [{ hierarchy_level: 20 }],
      save: vi.fn(async () => user2),
    };
    tenantModels.User.findByPk.mockResolvedValue(user2);
    const dev2 = makeDeviceRow({ operator_device_id: 21, user_id: 6, device_id: "dev-user2-21", status: "ACTIVE" });
    tenantModels.OperatorDevice.findAll.mockResolvedValue([dev2]);
    tenantModels.OperatorDevice.update.mockImplementation(async (patch) => Object.assign(dev2, patch));
    await deleteUser(tenantModels, 6);
    expect(dev2.status).toBe("REVOKED");
    expect(dev2.token_hash).toBeNull();
  });

  it("B.3 & admin routes: RBAC devices:manage vs 403, listShopDevices, PATCH capabilities sends wipe_cache, and PUT policy", async () => {
    const devPending = makeDeviceRow({
      operator_device_id: 31,
      user_id: 10,
      device_id: "dev-console-31",
      device_label: "Counter Phone",
      device_model: "Xiaomi Redmi Note 12",
      os_version: "13",
      app_version: "1.1.0",
      status: "PENDING",
      push_token: "fcm-31",
      reported_state: { battery_optimization_exempt: false, overlay_permission: true },
    });
    const auditLogs = [];
    let storedConfig = { custom_settings: {} };

    const managerUser = {
      user_id: 2,
      first_name: "Manager",
      last_name: "Perera",
      is_active: true,
      Roles: [
        {
          role_id: 3,
          role_name: "Floor Manager",
          hierarchy_level: 50,
          is_active: true,
          Permissions: [{ permission_code: "devices:manage" }],
        },
      ],
    };
    const cashierUser = {
      user_id: 3,
      first_name: "Cashier",
      last_name: "Silva",
      is_active: true,
      Roles: [{ role_id: 2, role_name: "Cashier", hierarchy_level: 20, is_active: true, Permissions: [] }],
    };

    const tenantModels = {
      TenantConfig: {
        findOne: vi.fn(async () => ({
          ...storedConfig,
          update: vi.fn(async (p) => {
            storedConfig = { ...storedConfig, ...p };
          }),
        })),
      },
      User: {
        findByPk: vi.fn(async (id) => {
          if (id === 3) return cashierUser;
          return managerUser;
        }),
      },
      Role: {},
      Permission: {},
      UserPermissionOverride: { findAll: vi.fn(async () => []) },
      OperatorDevice: {
        findAll: vi.fn(async () => [devPending]),
        findByPk: vi.fn(async (id) => (Number(id) === 31 ? devPending : null)),
      },
      PhoneContact: { findAll: vi.fn(async () => []) },
      CallLog: { findAll: vi.fn(async () => []) },
      DeviceAuditLog: {
        create: vi.fn(async (entry) => {
          const full = {
            audit_id: auditLogs.length + 1,
            createdAt: new Date(),
            ...entry,
            Actor: managerUser,
          };
          auditLogs.push(full);
          return full;
        }),
        findAll: vi.fn(async () => auditLogs),
      },
    };
    state.tenantModelsByDb.set("geargrid_shop1", tenantModels);

    const app = express();
    app.use(express.json());
    app.use("/api/phone-assistant", phoneAssistantRoutes);
    app.use(errorHandler);

    // Cashier without devices:manage gets 403
    state.protectUser = { userId: 3, tenantDbName: "geargrid_shop1" };
    const deniedRes = await request(app).get("/api/phone-assistant/devices");
    expect(deniedRes.status).toBe(403);

    // Floor manager WITH devices:manage can list devices and approve
    state.protectUser = { userId: 2, tenantDbName: "geargrid_shop1" };
    const listRes = await request(app).get("/api/phone-assistant/devices");
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.counts.pending).toBe(1);
    expect(listRes.body.data.devices[0].health_warnings).toContain("pending_approval");
    expect(listRes.body.data.devices[0].health_warnings).toContain("battery_restricted");

    const approveRes = await request(app)
      .post("/api/phone-assistant/devices/31/status")
      .send({ status: "ACTIVE" });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.device.status).toBe("ACTIVE");

    // Disable caller_brief -> wipes cache and logs capability_changed
    const patchRes = await request(app)
      .patch("/api/phone-assistant/devices/31")
      .send({ capabilities: { caller_brief: false }, muted: true });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.device.capabilities.caller_brief).toBe(false);
    expect(state.mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "wipe_cache" }) }),
    );

    // Wipe endpoint
    const wipeRes = await request(app)
      .post("/api/phone-assistant/devices/31/wipe")
      .send({ reason: "manual" });
    expect(wipeRes.status).toBe(200);
    expect(wipeRes.body.data.wiped).toBe(true);

    // Audit log endpoint
    const auditRes = await request(app).get("/api/phone-assistant/devices/31/audit");
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.data.logs.map((l) => l.action)).toEqual([
      "approved",
      "capability_changed",
      "wiped",
    ]);

    // PUT /policy requires Admin (manager is hierarchy 50 -> 403)
    const putDenied = await request(app)
      .put("/api/phone-assistant/policy")
      .send({ approval_mode: "admin_approves_all", offline_wipe_days: 5 });
    expect(putDenied.status).toBe(403);

    // Switch to Admin -> succeeds
    tenantModels.User.findByPk.mockResolvedValue({
      user_id: 1,
      is_active: true,
      Roles: [{ role_id: 1, hierarchy_level: 100, is_active: true, Permissions: [] }],
    });
    state.protectUser = { userId: 1, tenantDbName: "geargrid_shop1" };
    const putOk = await request(app)
      .put("/api/phone-assistant/policy")
      .send({ approval_mode: "admin_approves_all", offline_wipe_days: 5 });
    expect(putOk.status).toBe(200);
    expect(putOk.body.data.policy.approval_mode).toBe("admin_approves_all");
    expect(putOk.body.data.policy.offline_wipe_days).toBe(5);
  });
});
