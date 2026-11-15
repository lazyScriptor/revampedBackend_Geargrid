import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearTenantStatusCache } from "../../src/utils/tenantStatusCache.js";

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

const state = vi.hoisted(() => ({
  masterModels: {
    Tenant: {
      findOne: vi.fn(),
      findByPk: vi.fn(),
      findAll: vi.fn(),
    },
    DevicePairingCode: {
      findOne: vi.fn(),
    },
    DeviceRegistry: {
      findOne: vi.fn(),
      findByPk: vi.fn(),
      upsert: vi.fn(),
      destroy: vi.fn(),
    },
    GlobalUser: {
      update: vi.fn(),
      findOne: vi.fn(),
    },
  },
  tenantModelsByDb: new Map(),
  planByDb: new Map(),
  authUser: { tenantDbName: "geargrid_shop1", userId: 1 },
}));

vi.mock("../../src/models/master/index.js", () => ({
  getMasterModels: () => state.masterModels,
  initMasterModels: () => state.masterModels,
}));

vi.mock("../../src/config/database.js", () => ({
  getCachedTenantConnection: (dbName) => ({ dbName }),
  masterSequelize: { query: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../../src/models/index.js", () => ({
  initTenantModels: (conn) => state.tenantModelsByDb.get(conn?.dbName || "geargrid_shop1") || {},
}));

vi.mock("../../src/middlewares/authMiddleware.js", () => ({
  protect: (req, _res, next) => {
    // Deliberately omit req.tenantModels so A-01 tests router resolution from req.user.tenantDbName
    req.user = { ...state.authUser };
    next();
  },
  requirePermission: () => (_req, _res, next) => next(),
}));

vi.mock("../../src/middlewares/planMiddleware.js", () => ({
  requireFeature: (feature) => (req, res, next) => {
    const db = req.tenantDbName || req.user?.tenantDbName || "geargrid_shop1";
    const features = state.planByDb.get(db) || { phone_assistant: true };
    if (features[feature] === false) {
      return res.status(403).json({ status: "fail", message: "Feature disabled" });
    }
    return next();
  },
}));

vi.mock("../../src/services/planService.js", () => ({
  getTenantPlan: async (dbName) => ({
    features: state.planByDb.get(dbName) || { phone_assistant: true },
  }),
}));

vi.mock("../../src/utils/socketEmitter.js", () => ({
  emitToTenant: vi.fn(),
}));

const { default: errorHandler } = await import("../../src/middlewares/errorHandler.js");
const { default: callRoutes } = await import("../../src/routes/callRoutes.js");
const { default: deviceAppRoutes } = await import("../../src/routes/deviceAppRoutes.js");
const { default: deviceRoutes } = await import("../../src/routes/deviceRoutes.js");
const { deviceAuth } = await import("../../src/middlewares/deviceAuth.js");
const { revokeUserDevices, wipeBriefCacheIfCallsViewRemoved } = await import(
  "../../src/services/userService.js"
);
const { usePhoneContact, syncDeviceContacts } = await import(
  "../../src/services/phoneContactService.js"
);
const { __setMessagingForTests, sendDataPush, sendPushToDevice, sendToUsers } = await import(
  "../../src/services/devicePushService.js"
);
const { recordDeviceCall } = await import("../../src/services/callLogService.js");
const { claimPairingCode, getDeviceStatus, registerDevice, verifyDevicePublicAccess } = await import(
  "../../src/services/deviceService.js"
);
const { syncCustomerPhones } = await import("../../src/services/customerPhoneService.js");
const { buildBriefs } = await import("../../src/services/customerBriefService.js");

const buildTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/calls", callRoutes);
  app.use("/api/public/devices", deviceRoutes);
  app.use("/api/device", deviceAppRoutes);
  app.use(errorHandler);
  return app;
};

describe("GearGrid Phone Assistant — Release 2 Part A Bug Fixes", () => {
  const mockSend = vi.fn();

  beforeEach(() => {
    clearTenantStatusCache();
    vi.clearAllMocks();
    state.tenantModelsByDb.clear();
    state.planByDb.clear();
    state.authUser = { tenantDbName: "geargrid_shop1", userId: 1 };
    mockSend.mockResolvedValue("msg-id-1");
    state.masterModels.DeviceRegistry.destroy.mockResolvedValue(1);
    state.masterModels.DeviceRegistry.upsert.mockResolvedValue(true);
    __setMessagingForTests({ send: mockSend });
    state.masterModels.Tenant.findOne.mockResolvedValue({
      tenant_id: 1,
      db_name: "geargrid_shop1",
      subscription_status: "Active",
      feature_flags: null,
    });
    state.masterModels.Tenant.findByPk.mockResolvedValue({
      tenant_id: 1,
      db_name: "geargrid_shop1",
      display_name: "Shop One",
      subscription_status: "Active",
      feature_flags: null,
    });
  });

  it("A-01: callRoutes resolves tenant models from req.user.tenantDbName on GET /api/calls and GET /api/calls/:id", async () => {
    const callRow = {
      call_id: 77,
      client_call_id: "call-77",
      operator_device_id: 3,
      phone_e164: "94771234567",
      raw_number: "0771234567",
      direction: "INCOMING",
      state: "ENDED",
      duration_seconds: 18,
      customer_id: null,
      contact_id: null,
      started_at: new Date("2026-11-15T10:00:00Z"),
      ended_at: new Date("2026-11-15T10:00:18Z"),
      OperatorDevice: { operator_device_id: 3, device_label: "Front Desk" },
    };

    const tenantModels = {
      CallLog: {
        findAndCountAll: vi.fn().mockResolvedValue({ count: 1, rows: [callRow] }),
        findByPk: vi.fn().mockResolvedValue(callRow),
      },
      OperatorDevice: {},
      Customer: {},
      PhoneContact: {},
    };
    state.tenantModelsByDb.set("geargrid_shop1", tenantModels);

    const app = buildTestApp();
    const listRes = await request(app).get("/api/calls");
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.calls).toHaveLength(1);
    expect(listRes.body.data.calls[0].call_id).toBe(77);

    const oneRes = await request(app).get("/api/calls/77");
    expect(oneRes.status).toBe(200);
    expect(oneRes.body.data.call.call_id).toBe(77);
    expect(oneRes.body.data.match).toBe("none");
  });

  it("A-03: deviceAuth rejects inactive/deleted users (401 device_revoked) and revokeUserDevices wipes tokens + sends push", async () => {
    const rawToken = "b".repeat(64);
    const inactiveModels = {
      OperatorDevice: {
        findOne: vi.fn().mockResolvedValue({
          operator_device_id: 5,
          user_id: 9,
          device_id: "dev-12345678",
          token_hash: sha256(rawToken),
          last_seen_at: new Date(),
          update: vi.fn(),
        }),
      },
      User: {
        findByPk: vi.fn().mockResolvedValue({ user_id: 9, is_active: false, Roles: [] }),
      },
      Role: {},
      Permission: {},
    };
    state.tenantModelsByDb.set("geargrid_shop1", inactiveModels);

    const req = {
      headers: {
        "x-device-id": "dev-12345678",
        "x-tenant-db": "geargrid_shop1",
        authorization: `Bearer ${rawToken}`,
      },
    };
    const next = vi.fn();
    await deviceAuth(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("device_revoked");

    // revokeUserDevices destroys synced contacts, sends device_revoked push, and nulls token_hash & push_token
    const phoneDestroy = vi.fn().mockResolvedValue(3);
    const deviceUpdate = vi.fn().mockResolvedValue([1]);
    const revokedCount = await revokeUserDevices(
      {
        OperatorDevice: {
          findAll: vi.fn().mockResolvedValue([
            { operator_device_id: 5, user_id: 9, push_token: "fcm-abc" },
          ]),
          update: deviceUpdate,
        },
        PhoneContact: { destroy: phoneDestroy },
      },
      9,
    );
    expect(revokedCount).toBe(1);
    expect(phoneDestroy).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "fcm-abc",
        data: expect.objectContaining({ type: "device_revoked" }),
      }),
    );
    expect(deviceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        token_hash: null,
        push_token: null,
        contact_sync_enabled: false,
      }),
      expect.anything(),
    );

    // Removing calls:view pushes wipe_cache via wipeBriefCacheIfCallsViewRemoved
    mockSend.mockClear();
    const wiped = await wipeBriefCacheIfCallsViewRemoved(
      {
        User: {
          findByPk: vi.fn().mockResolvedValue({
            user_id: 9,
            is_active: true,
            Roles: [{ is_active: true, hierarchy_level: 10, Permissions: [] }],
          }),
        },
        Role: {},
        Permission: {},
        OperatorDevice: {
          findAll: vi.fn().mockResolvedValue([{ operator_device_id: 5, push_token: "fcm-xyz" }]),
        },
      },
      9,
    );
    expect(wiped).toBe(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "fcm-xyz",
        data: expect.objectContaining({ type: "wipe_cache" }),
      }),
    );
  });

  it("A-04: /api/device/briefs and /api/device/briefs/lookup enforce calls:view (403) and push wipe_cache", async () => {
    const rawToken = "c".repeat(64);
    state.tenantModelsByDb.set("geargrid_shop1", {
      OperatorDevice: {
        findOne: vi.fn().mockResolvedValue({
          operator_device_id: 6,
          user_id: 22,
          device_id: "dev-perm-check",
          token_hash: sha256(rawToken),
          push_token: "fcm-perm-1",
          last_seen_at: new Date(),
          update: vi.fn(),
        }),
      },
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 22,
          is_active: true,
          Roles: [
            {
              role_id: 2,
              role_name: "Clerk",
              hierarchy_level: 10,
              is_active: true,
              Permissions: [{ permission_code: "invoice:create" }],
            },
          ],
        }),
      },
      Role: {},
      Permission: {},
      UserPermissionOverride: { findAll: vi.fn().mockResolvedValue([]) },
    });

    const app = buildTestApp();
    const headers = {
      "x-device-id": "dev-perm-check",
      "x-tenant-db": "geargrid_shop1",
      authorization: `Bearer ${rawToken}`,
    };

    const briefsRes = await request(app).get("/api/device/briefs").set(headers);
    expect(briefsRes.status).toBe(403);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "fcm-perm-1",
        data: expect.objectContaining({ type: "wipe_cache" }),
      }),
    );

    mockSend.mockClear();
    const lookupRes = await request(app).get("/api/device/briefs/lookup?phone=0771234567").set(headers);
    expect(lookupRes.status).toBe(403);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "fcm-perm-1",
        data: expect.objectContaining({ type: "wipe_cache" }),
      }),
    );
  });

  it("A-05: usePhoneContact requires matching 9+ digit phone and rejects already-linked or sync-disabled contacts", async () => {
    const contactRow = {
      contact_id: 9,
      display_name: "Nimal Perera",
      phone_e164: "94771234567",
      raw_phone: "0771234567",
      linked_customer_id: null,
      OperatorDevice: { operator_device_id: 3, contact_sync_enabled: true },
      update: vi.fn().mockResolvedValue(true),
    };
    const models = {
      OperatorDevice: {},
      PhoneContact: { findByPk: vi.fn().mockResolvedValue(contactRow) },
    };

    await expect(usePhoneContact(models, 9, { userId: 1 }, { phone: "07712" })).rejects.toMatchObject({
      statusCode: 400,
    });

    await expect(usePhoneContact(models, 9, { userId: 1 }, { phone: "0779999999" })).rejects.toMatchObject({
      statusCode: 403,
    });

    contactRow.linked_customer_id = 55;
    await expect(usePhoneContact(models, 9, { userId: 1 }, { phone: "0771234567" })).rejects.toMatchObject({
      statusCode: 409,
    });

    contactRow.linked_customer_id = null;
    contactRow.OperatorDevice.contact_sync_enabled = false;
    await expect(usePhoneContact(models, 9, { userId: 1 }, { phone: "0771234567" })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("A-06: POST /api/device/unpair works even when phone_assistant feature is disabled", async () => {
    const rawToken = "d".repeat(64);
    const deviceDestroy = vi.fn().mockResolvedValue(1);
    const contactDestroy = vi.fn().mockResolvedValue(4);
    state.planByDb.set("geargrid_shop1", { phone_assistant: false });
    state.tenantModelsByDb.set("geargrid_shop1", {
      OperatorDevice: {
        findOne: vi.fn().mockResolvedValue({
          operator_device_id: 15,
          user_id: 2,
          device_id: "dev-unpair-1",
          token_hash: sha256(rawToken),
          last_seen_at: new Date(),
          destroy: deviceDestroy,
        }),
      },
      PhoneContact: { destroy: contactDestroy },
      User: {
        findByPk: vi.fn().mockResolvedValue({ user_id: 2, is_active: true, Roles: [] }),
      },
      Role: {},
      Permission: {},
    });

    const app = buildTestApp();
    const res = await request(app)
      .post("/api/device/unpair")
      .set({
        "x-device-id": "dev-unpair-1",
        "x-tenant-db": "geargrid_shop1",
        authorization: `Bearer ${rawToken}`,
      });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ status: "success", data: { unpaired: true } });
    expect(contactDestroy).toHaveBeenCalledWith({ where: { operator_device_id: 15 } });
    expect(state.masterModels.DeviceRegistry.destroy).toHaveBeenCalledWith({
      where: { device_id: "dev-unpair-1" },
    });
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("A-08: sendPushToDevice, sendDataPush, and sendToUsers send data-only FCM without notification field", async () => {
    const dev = { operator_device_id: 1, push_token: "fcm-data-only" };

    await sendPushToDevice(
      {},
      dev,
      { title: "Invoice #9", body: "Overdue", data: { type: "overdue", invoice_id: 9 }, silent: false },
    );
    expect(mockSend).toHaveBeenCalledWith({
      token: "fcm-data-only",
      data: {
        type: "overdue",
        invoice_id: "9",
        title: "Invoice #9",
        body: "Overdue",
        channel: "bills",
      },
      android: { priority: "high" },
    });
    expect(mockSend.mock.calls[0][0].notification).toBeUndefined();

    mockSend.mockClear();
    await sendDataPush(dev, { type: "wipe_cache" });
    expect(mockSend).toHaveBeenCalledWith({
      token: "fcm-data-only",
      data: expect.objectContaining({ type: "wipe_cache" }),
      android: { priority: "high" },
    });

    mockSend.mockClear();
    await sendToUsers(
      { OperatorDevice: { findAll: vi.fn().mockResolvedValue([dev]) } },
      [1],
      { title: "Paid", body: "LKR 500", data: { invoice_id: 3 }, silent: true },
    );
    expect(mockSend).toHaveBeenCalledWith({
      token: "fcm-data-only",
      data: {
        invoice_id: "3",
        title: "Paid",
        body: "LKR 500",
        channel: "bills_silent",
        silent: "true",
      },
      android: { priority: "normal" },
    });
    expect(mockSend.mock.calls[0][0].notification).toBeUndefined();
  });

  it("A-11: recordDeviceCall skips unknown numbers under default customers_and_contacts scope", async () => {
    const callCreate = vi.fn();
    const models = {
      CustomerPhone: { findAll: vi.fn().mockResolvedValue([]) },
      Customer: { findAll: vi.fn().mockResolvedValue([]) },
      PhoneContact: { findOne: vi.fn().mockResolvedValue(null) },
      CallLog: { findOne: vi.fn(), create: callCreate },
    };

    const skippedRes = await recordDeviceCall(
      models,
      "geargrid_shop1",
      { operator_device_id: 1, user_id: 1 },
      {
        client_call_id: "unknown-call-1",
        raw_number: "0770001112",
        direction: "INCOMING",
        state: "RINGING",
        started_at: "2026-11-15T10:00:00Z",
      },
    );
    expect(skippedRes).toEqual({
      call_id: 0,
      client_call_id: "unknown-call-1",
      customer_id: null,
      contact_id: null,
      emitted: false,
      skipped: true,
    });
    expect(callCreate).not.toHaveBeenCalled();

    // Known customer IS stored cleanly
    models.CustomerPhone.findAll.mockResolvedValue([{ customer_id: 41 }]);
    models.CallLog.findOne.mockResolvedValue(null);
    callCreate.mockResolvedValue({
      call_id: 501,
      client_call_id: "known-call-1",
      operator_device_id: 1,
      phone_e164: "94770001112",
      raw_number: "0770001112",
      direction: "INCOMING",
      state: "RINGING",
      duration_seconds: null,
      customer_id: 41,
      contact_id: null,
      started_at: new Date("2026-11-15T10:00:00Z"),
      ended_at: null,
    });
    const storedRes = await recordDeviceCall(
      models,
      "geargrid_shop1",
      { operator_device_id: 1, user_id: 1 },
      {
        client_call_id: "known-call-1",
        raw_number: "0770001112",
        direction: "INCOMING",
        state: "RINGING",
        started_at: "2026-11-15T10:00:00Z",
      },
    );
    expect(storedRes.call_id).toBe(501);
    expect(callCreate).toHaveBeenCalledTimes(1);
  });

  it("A-13 & A-14: claimPairingCode resets user state on user switch and revokes old shop via DeviceRegistry on shop switch", async () => {
    const oldShopContactDestroy = vi.fn().mockResolvedValue(2);
    const oldShopDeviceDestroy = vi.fn().mockResolvedValue(1);
    state.tenantModelsByDb.set("geargrid_old_shop", {
      OperatorDevice: {
        findOne: vi.fn().mockResolvedValue({
          operator_device_id: 91,
          destroy: oldShopDeviceDestroy,
        }),
      },
      PhoneContact: { destroy: oldShopContactDestroy },
    });

    const newShopContactDestroy = vi.fn().mockResolvedValue(5);
    const existingNewShopDeviceUpdate = vi.fn().mockResolvedValue(true);
    const existingNewShopDevice = {
      operator_device_id: 33,
      user_id: 10, // previous user in new shop
      device_label: "Old Label",
      user_agent: "Android",
      update: existingNewShopDeviceUpdate,
      paired_at: new Date(),
    };
    state.tenantModelsByDb.set("geargrid_shop1", {
      OperatorDevice: { findOne: vi.fn().mockResolvedValue(existingNewShopDevice) },
      PhoneContact: { destroy: newShopContactDestroy },
      TenantConfig: { findOne: vi.fn().mockResolvedValue({ business_display_name: "Shop One" }) },
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 20,
          first_name: "Saman",
          last_name: "Perera",
          username: "saman",
          signature_url: null,
        }),
      },
    });

    const pairingCodeUpdate = vi.fn().mockResolvedValue(true);
    state.masterModels.DevicePairingCode.findOne.mockResolvedValue({
      code: "123456",
      status: "PENDING",
      tenant_id: 1,
      user_id: 20, // new user
      expires_at: new Date(Date.now() + 60_000),
      update: pairingCodeUpdate,
    });
    state.masterModels.DeviceRegistry.findOne.mockResolvedValue({
      device_id: "device-switch-1",
      tenant_id: 99,
    });
    state.masterModels.Tenant.findByPk.mockImplementation(async (id) => {
      if (id === 99) return { tenant_id: 99, db_name: "geargrid_old_shop" };
      return { tenant_id: 1, db_name: "geargrid_shop1", display_name: "Shop One" };
    });

    await claimPairingCode(state.masterModels, {
      code: "123456",
      device_id: "device-switch-1",
      device_label: "Counter Phone",
      user_agent: "GearGrid/1.0 Capacitor",
    });

    // A-14 old shop cleanup + registry upsert
    expect(oldShopContactDestroy).toHaveBeenCalledWith({ where: { operator_device_id: 91 } });
    expect(oldShopDeviceDestroy).toHaveBeenCalledTimes(1);
    expect(state.masterModels.DeviceRegistry.upsert).toHaveBeenCalledWith({
      device_id: "device-switch-1",
      tenant_id: "1",
    });

    // A-13 same-shop user change wiped contacts & reset sync timestamps/flags
    expect(newShopContactDestroy).toHaveBeenCalledWith({ where: { operator_device_id: 33 } });
    expect(existingNewShopDeviceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 20,
        contact_sync_enabled: false,
        push_token: null,
        push_token_updated_at: null,
        contacts_synced_at: null,
        briefs_synced_at: null,
      }),
    );
  });

  it("A-15: deviceAuth returns 403 shop_inactive for inactive tenants and getDeviceStatus reports shop_inactive", async () => {
    state.masterModels.Tenant.findOne.mockResolvedValue({
      tenant_id: 1,
      db_name: "geargrid_shop1",
      subscription_status: "Suspended",
      feature_flags: null,
    });

    const next = vi.fn();
    await deviceAuth(
      {
        headers: {
          "x-device-id": "dev-12345678",
          "x-tenant-db": "geargrid_shop1",
          authorization: `Bearer ${"a".repeat(64)}`,
        },
      },
      {},
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
    expect(next.mock.calls[0][0].code).toBe("shop_inactive");

    state.masterModels.DeviceRegistry.findOne.mockResolvedValue({
      device_id: "dev-12345678",
      tenant_id: 1,
    });
    state.masterModels.Tenant.findByPk.mockResolvedValue({
      tenant_id: 1,
      db_name: "geargrid_shop1",
      subscription_status: "Suspended",
      feature_flags: null,
    });
    state.tenantModelsByDb.set("geargrid_shop1", {
      OperatorDevice: {
        findOne: vi.fn().mockResolvedValue({
          device_id: "dev-12345678",
          User: { user_id: 1, first_name: "Kasun", last_name: "", username: "kasun" },
          update: vi.fn().mockResolvedValue(true),
        }),
      },
      User: {},
      TenantConfig: { findOne: vi.fn().mockResolvedValue({ business_display_name: "Shop One" }) },
    });

    const status = await getDeviceStatus(state.masterModels, "dev-12345678");
    expect(status.paired).toBe(true);
    expect(status.shop_inactive).toBe(true);
  });

  it("A-17: verifyDevicePublicAccess rejects native requests without valid token (401)", async () => {
    const rawToken = "e".repeat(64);
    state.masterModels.DeviceRegistry.findOne.mockResolvedValue({
      device_id: "dev-native-1",
      tenant_id: 1,
    });
    state.tenantModelsByDb.set("geargrid_shop1", {
      OperatorDevice: {
        findOne: vi.fn().mockResolvedValue({
          operator_device_id: 8,
          user_id: 1,
          device_id: "dev-native-1",
          is_native_app: true,
          token_hash: sha256(rawToken),
          User: { user_id: 1 },
          update: vi.fn(),
        }),
      },
      User: {},
      SignatureRequest: { findAll: vi.fn().mockResolvedValue([]) },
      Invoice: { findAll: vi.fn().mockResolvedValue([]) },
      InvoiceSignature: { findAll: vi.fn().mockResolvedValue([]) },
      TenantConfig: { findOne: vi.fn().mockResolvedValue({}) },
    });

    await expect(
      verifyDevicePublicAccess(state.masterModels, "dev-native-1", null, { isNativeClient: true }),
    ).rejects.toMatchObject({ statusCode: 401 });

    // Route-level check via x-app-platform: android or Capacitor UA
    const app = buildTestApp();
    const unauthRes = await request(app)
      .get("/api/public/devices/dev-native-1/pending-signatures")
      .set("x-app-platform", "android");
    expect(unauthRes.status).toBe(401);

    const uaUnauth = await request(app)
      .get("/api/public/devices/dev-native-1/pending-signatures")
      .set("user-agent", "Mozilla/5.0 Capacitor");
    expect(uaUnauth.status).toBe(401);

    const okRes = await request(app)
      .get("/api/public/devices/dev-native-1/pending-signatures")
      .set({ "x-app-platform": "android", "x-device-token": rawToken });
    expect(okRes.status).toBe(200);
    expect(okRes.body).toEqual({ status: "success", data: { pending: [] } });
  });

  it("A-18: registerDevice accepts a 400-char push_token and rejects >512 chars with 400", async () => {
    const device = {
      operator_device_id: 4,
      user_id: 1,
      contact_sync_enabled: false,
      update: vi.fn().mockResolvedValue(true),
    };
    const models = {
      User: {
        findByPk: vi.fn().mockResolvedValue({ user_id: 1, is_active: true, Roles: [] }),
      },
      Role: {},
    };

    const token400 = "f".repeat(400);
    await registerDevice(models, "geargrid_shop1", device, { push_token: token400 });
    expect(device.update).toHaveBeenCalledWith(
      expect.objectContaining({ push_token: token400 }),
    );

    const token513 = "g".repeat(513);
    await expect(
      registerDevice(models, "geargrid_shop1", device, { push_token: token513 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("A-19: syncCustomerPhones links unlinked PhoneContact rows, unlinks removed phones, and unlinks on soft-delete", async () => {
    const phoneUpdate = vi.fn().mockResolvedValue([1]);
    const models = {
      CustomerPhone: {
        destroy: vi.fn().mockResolvedValue(1),
        bulkCreate: vi.fn().mockResolvedValue([]),
      },
      PhoneContact: { update: phoneUpdate },
    };

    await syncCustomerPhones(models, {
      customer_id: 88,
      phone_number: "0771234567",
      customer_delete_status: false,
    });
    expect(phoneUpdate).toHaveBeenCalledTimes(2);
    expect(phoneUpdate).toHaveBeenNthCalledWith(
      2,
      { linked_customer_id: 88 },
      expect.objectContaining({
        where: expect.objectContaining({ linked_customer_id: null }),
      }),
    );

    phoneUpdate.mockClear();
    await syncCustomerPhones(models, {
      customer_id: 88,
      phone_number: "0771234567",
      customer_delete_status: true,
    });
    expect(phoneUpdate).toHaveBeenCalledWith(
      { linked_customer_id: null },
      { where: { linked_customer_id: 88 } },
    );
  });

  it("A-21: syncDeviceContacts rejects empty full sync without confirm_empty (409) when contacts exist", async () => {
    const device = {
      operator_device_id: 12,
      contact_sync_enabled: true,
      update: vi.fn().mockResolvedValue(true),
    };
    const models = {
      PhoneContact: {
        count: vi.fn().mockResolvedValue(15),
        destroy: vi.fn().mockResolvedValue(15),
      },
    };

    await expect(
      syncDeviceContacts(models, device, { full: true, final: true, upserts: [] }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(models.PhoneContact.destroy).not.toHaveBeenCalled();

    const confirmed = await syncDeviceContacts(models, device, {
      full: true,
      final: true,
      confirm_empty: true,
      upserts: [],
    });
    expect(confirmed.accepted).toBe(0);
    expect(models.PhoneContact.destroy).toHaveBeenCalledTimes(1);
  });

  it("A-22: buildBriefs returns earliest_overdue_due across active overdue items and null otherwise", async () => {
    const models = {
      Customer: {
        findAll: vi.fn().mockResolvedValue([
          {
            customer_id: 10,
            first_name: "Amal",
            last_name: "Silva",
            phone_number: "0771234567",
            deposit_balance: 0,
            rating: 4.5,
            status: "Active",
            customer_delete_status: false,
            is_id_retained_currently: false,
          },
          {
            customer_id: 11,
            first_name: "Bimal",
            last_name: "Perera",
            phone_number: "0779998887",
            deposit_balance: 0,
            rating: 5,
            status: "Active",
            customer_delete_status: false,
            is_id_retained_currently: false,
          },
        ]),
      },
      CustomerPhone: { findAll: vi.fn().mockResolvedValue([]) },
      Invoice: {
        findAll: vi.fn().mockResolvedValue([
          {
            invoice_id: 1,
            customer_id: 10,
            status: "Active",
            issued_date: "2026-11-01",
            total_amount: 1000,
            is_deleted: false,
            Payments: [],
            InvoiceLines: [
              {
                equipment_id: 1,
                borrow_quantity: 1,
                good_returned_qty: 0,
                defective_returned_qty: 0,
                line_status: "Active",
                is_open_ended: false,
                expected_return_date: "2026-11-12",
                Equipment: { equipment_name: "Drill" },
              },
              {
                equipment_id: 2,
                borrow_quantity: 1,
                good_returned_qty: 0,
                defective_returned_qty: 0,
                line_status: "Active",
                is_open_ended: false,
                expected_return_date: "2026-11-10",
                Equipment: { equipment_name: "Grinder" },
              },
            ],
          },
          {
            invoice_id: 2,
            customer_id: 11,
            status: "Active",
            issued_date: "2026-11-14",
            total_amount: 500,
            is_deleted: false,
            Payments: [],
            InvoiceLines: [
              {
                equipment_id: 3,
                borrow_quantity: 1,
                good_returned_qty: 0,
                defective_returned_qty: 0,
                line_status: "Active",
                is_open_ended: false,
                expected_return_date: "2026-11-20",
                Equipment: { equipment_name: "Ladder" },
              },
            ],
          },
        ]),
      },
      InvoiceLine: {},
      Equipment: {},
      Payment: {},
      InvoiceReview: { findAll: vi.fn().mockResolvedValue([]) },
    };

    const briefs = await buildBriefs(models, [10, 11], {
      now: new Date("2026-11-15T12:00:00Z"),
    });
    expect(briefs).toHaveLength(2);
    expect(briefs[0].earliest_overdue_due).toBe("2026-11-10");
    expect(briefs[1].earliest_overdue_due).toBeNull();
  });
});
