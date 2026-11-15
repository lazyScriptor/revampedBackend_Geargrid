import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearTenantStatusCache } from "../../src/utils/tenantStatusCache.js";
import { DEFAULT_PLANS, FEATURE_KEYS } from "../../src/config/planCatalog.js";

const mockTenantFindOne = vi.fn();
const mockGetCachedTenantConnection = vi.fn(() => ({ id: "conn" }));
const mockInitTenantModels = vi.fn();
const mockGetTenantPlan = vi.fn();

vi.mock("../../src/models/master/index.js", () => ({
  getMasterModels: () => ({
    Tenant: { findOne: mockTenantFindOne },
  }),
}));

vi.mock("../../src/config/database.js", () => ({
  getCachedTenantConnection: (...args) => mockGetCachedTenantConnection(...args),
  masterSequelize: { query: vi.fn() },
}));

vi.mock("../../src/models/index.js", () => ({
  initTenantModels: (...args) => mockInitTenantModels(...args),
}));

vi.mock("../../src/services/planService.js", () => ({
  getTenantPlan: (...args) => mockGetTenantPlan(...args),
}));

const { deviceAuth } = await import("../../src/middlewares/deviceAuth.js");
const { registerDevice } = await import("../../src/services/deviceService.js");
const { listAdminUserIds, isUserAdmin } = await import("../../src/services/userService.js");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

describe("Plan catalog & permissions (A3)", () => {
  it("enables phone_assistant only on Enterprise by default", () => {
    expect(FEATURE_KEYS).toContain("phone_assistant");
    expect(DEFAULT_PLANS.Basic.features.phone_assistant).toBe(false);
    expect(DEFAULT_PLANS.Pro.features.phone_assistant).toBe(false);
    expect(DEFAULT_PLANS.Enterprise.features.phone_assistant).toBe(true);
  });
});

describe("deviceAuth middleware", () => {
  beforeEach(() => {
    clearTenantStatusCache();
    vi.clearAllMocks();
  });

  const makeRes = () => ({});

  it("authenticates a valid bearer device_token, attaches req.device/req.tenantModels, and throttles last_seen_at to once per minute", async () => {
    const rawToken = "a".repeat(64);
    mockTenantFindOne.mockResolvedValue({
      subscription_status: "Active",
      feature_flags: null,
    });
    const device = {
      operator_device_id: 5,
      user_id: 9,
      device_id: "device-12345678",
      token_hash: sha256(rawToken),
      last_seen_at: null,
      update: vi.fn().mockImplementation(async function (patch) {
        Object.assign(this, patch);
        return this;
      }),
    };
    const tenantModels = { OperatorDevice: { findOne: vi.fn().mockResolvedValue(device) } };
    mockInitTenantModels.mockReturnValue(tenantModels);

    const req1 = {
      headers: {
        "x-device-id": "device-12345678",
        "x-tenant-db": "geargrid_demo",
        authorization: `Bearer ${rawToken}`,
      },
    };
    const next1 = vi.fn();
    await deviceAuth(req1, makeRes(), next1);

    expect(next1).toHaveBeenCalledWith();
    expect(req1.device).toBe(device);
    expect(req1.tenantModels).toBe(tenantModels);
    expect(req1.tenantDbName).toBe("geargrid_demo");
    expect(device.update).toHaveBeenCalledTimes(1);

    // Second request within 60s should not update last_seen_at again
    const req2 = {
      headers: {
        "x-device-id": "device-12345678",
        "x-tenant-db": "geargrid_demo",
        authorization: `Bearer ${rawToken}`,
      },
    };
    const next2 = vi.fn();
    await deviceAuth(req2, makeRes(), next2);
    expect(next2).toHaveBeenCalledWith();
    expect(device.update).toHaveBeenCalledTimes(1);
  });

  it("rejects wrong token, missing headers, and legacy devices without token_hash with 401", async () => {
    mockTenantFindOne.mockResolvedValue({
      subscription_status: "Active",
      feature_flags: null,
    });

    const device = {
      operator_device_id: 5,
      device_id: "device-12345678",
      token_hash: sha256("correct-token"),
      update: vi.fn(),
    };
    const legacyDevice = {
      operator_device_id: 6,
      device_id: "device-legacy-12",
      token_hash: null,
      update: vi.fn(),
    };
    mockInitTenantModels.mockReturnValue({
      OperatorDevice: {
        findOne: vi.fn().mockImplementation(async ({ where }) =>
          where.device_id === "device-legacy-12" ? legacyDevice : device,
        ),
      },
    });

    // Missing header
    const n1 = vi.fn();
    await deviceAuth({ headers: { "x-device-id": "device-12345678" } }, makeRes(), n1);
    expect(n1.mock.calls[0][0].statusCode).toBe(401);

    // Wrong token
    const n2 = vi.fn();
    await deviceAuth(
      {
        headers: {
          "x-device-id": "device-12345678",
          "x-tenant-db": "geargrid_demo",
          authorization: "Bearer wrong-token",
        },
      },
      makeRes(),
      n2,
    );
    expect(n2.mock.calls[0][0].statusCode).toBe(401);

    // Legacy device without token_hash
    const n3 = vi.fn();
    await deviceAuth(
      {
        headers: {
          "x-device-id": "device-legacy-12",
          "x-tenant-db": "geargrid_demo",
          authorization: "Bearer any-token",
        },
      },
      makeRes(),
      n3,
    );
    expect(n3.mock.calls[0][0].statusCode).toBe(401);
  });
});

describe("registerDevice and listAdminUserIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks device native, wipes PHONE_CONTACTS when contact_sync_enabled=false, and returns is_admin + features", async () => {
    mockGetTenantPlan.mockResolvedValue({
      tier: "Enterprise",
      features: { phone_assistant: true, messages: true },
    });

    const device = {
      operator_device_id: 11,
      user_id: 4,
      contact_sync_enabled: true,
      update: vi.fn().mockImplementation(async function (patch) {
        Object.assign(this, patch);
        return this;
      }),
    };
    const models = {
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 4,
          is_active: true,
          Roles: [{ role_id: 1, role_name: "Admin", hierarchy_level: 100, is_active: true }],
        }),
      },
      Role: {},
      PhoneContact: {
        destroy: vi.fn().mockResolvedValue(12),
      },
    };

    const res = await registerDevice(models, "geargrid_demo", device, {
      app_version: "1.0.0",
      push_token: "fcm-tok-1",
      contact_sync_enabled: false,
    });

    expect(device.update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_native_app: true,
        app_version: "1.0.0",
        push_token: "fcm-tok-1",
        contact_sync_enabled: false,
      }),
    );
    expect(models.PhoneContact.destroy).toHaveBeenCalledWith({
      where: { operator_device_id: 11 },
    });
    expect(res).toEqual({
      is_admin: true,
      contact_sync_enabled: false,
      features: { phone_assistant: true, messages: true },
    });
  });

  it("listAdminUserIds returns active admin user IDs only (hierarchy_level >= 100)", async () => {
    expect(
      isUserAdmin({
        is_active: true,
        Roles: [{ role_name: "Cashier", hierarchy_level: 20, is_active: true }],
      }),
    ).toBe(false);
    expect(
      isUserAdmin({
        is_active: true,
        Roles: [{ role_name: "Admin", hierarchy_level: 50, is_active: true }],
      }),
    ).toBe(false);
    expect(
      isUserAdmin({
        is_active: true,
        Roles: [{ role_name: "Owner", hierarchy_level: 99, is_active: true }],
      }),
    ).toBe(false);

    const models = {
      User: {
        findAll: vi.fn().mockResolvedValue([
          {
            user_id: 1,
            is_active: true,
            Roles: [{ role_name: "Owner", hierarchy_level: 100, is_active: true }],
          },
          {
            user_id: 2,
            is_active: true,
            Roles: [{ role_name: "Staff", hierarchy_level: 10, is_active: true }],
          },
          {
            user_id: 3,
            is_active: true,
            Roles: [{ role_name: "Admin", hierarchy_level: 50, is_active: false }],
          },
          {
            user_id: 4,
            is_active: true,
            Roles: [{ role_name: "Admin", hierarchy_level: 50, is_active: true }],
          },
        ]),
      },
      Role: {},
    };
    const ids = await listAdminUserIds(models);
    expect(ids).toEqual([1]);
  });
});
