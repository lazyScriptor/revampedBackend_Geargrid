import { describe, it, expect, vi } from "vitest";
import {
  mintPairingCode,
  claimPairingCode,
  getDeviceStatus,
  unpairDevice,
  listMyDevices,
} from "../../src/services/deviceService.js";

// Mock the tenantConnection + initTenantModels wiring so claimPairingCode
// can "switch into" a target tenant without a real MySQL connection.
vi.mock("../../src/config/database.js", () => ({
  getCachedTenantConnection: vi.fn().mockReturnValue({}),
}));
vi.mock("../../src/models/index.js", () => ({
  initTenantModels: vi.fn(),
}));
import { initTenantModels } from "../../src/models/index.js";

const buildMasterModels = ({
  existingCode = null,
  tenant = null,
} = {}) => {
  const codes = existingCode ? [existingCode] : [];
  return {
    DevicePairingCode: {
      create: vi.fn().mockImplementation(async (payload) => {
        const row = {
          pairing_code_id: codes.length + 1,
          ...payload,
          update: vi.fn().mockImplementation(async (patch) => Object.assign(row, patch)),
        };
        codes.push(row);
        return row;
      }),
      findOne: vi.fn().mockImplementation(async ({ where }) => {
        return (
          codes.find(
            (c) =>
              (!where.code || c.code === where.code) &&
              (!where.status || c.status === where.status),
          ) || null
        );
      }),
      update: vi.fn().mockResolvedValue([0]),
    },
    Tenant: {
      findByPk: vi.fn().mockImplementation(async (id) => (tenant && tenant.tenant_id === id ? tenant : null)),
      findAll: vi.fn().mockResolvedValue(tenant ? [tenant] : []),
    },
    _codes: codes,
  };
};

const buildTenantModels = ({ existingDevice = null, user, tenantConfig } = {}) => {
  const devices = existingDevice ? [existingDevice] : [];
  return {
    OperatorDevice: {
      findOne: vi.fn().mockImplementation(async ({ where }) =>
        devices.find((d) => d.device_id === where.device_id || d.operator_device_id === where.operator_device_id) || null,
      ),
      findAll: vi.fn().mockImplementation(async ({ where }) =>
        devices.filter((d) => !where || d.user_id === where.user_id),
      ),
      create: vi.fn().mockImplementation(async (payload) => {
        const row = {
          operator_device_id: devices.length + 1,
          ...payload,
          update: vi.fn().mockImplementation(async (patch) => Object.assign(row, patch)),
          destroy: vi.fn().mockResolvedValue(undefined),
        };
        devices.push(row);
        return row;
      }),
    },
    User: {
      findByPk: vi.fn().mockImplementation(async (id) =>
        user && user.user_id === id ? user : null,
      ),
    },
    TenantConfig: {
      findOne: vi.fn().mockResolvedValue(tenantConfig || null),
    },
    _devices: devices,
  };
};

describe("Device pairing — POS-mints-code flow", () => {
  it("mintPairingCode returns a well-formed code and inserts a PENDING master row", async () => {
    const masterModels = buildMasterModels();

    const result = await mintPairingCode(masterModels, { tenant_id: 7, user_id: 42 });

    expect(result.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    expect(new Date(result.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(masterModels.DevicePairingCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 7,
        user_id: 42,
        status: "PENDING",
      }),
    );
  });

  it("mintPairingCode never reuses characters 0/O/1/I/L", async () => {
    const masterModels = buildMasterModels();
    const result = await mintPairingCode(masterModels, { tenant_id: 1, user_id: 1 });
    expect(result.code).not.toMatch(/[0O1IL]/);
  });

  it("claimPairingCode binds device to the code's tenant and flips code to CLAIMED", async () => {
    const existingCode = {
      pairing_code_id: 1,
      code: "ABC-DEF",
      tenant_id: 7,
      user_id: 42,
      status: "PENDING",
      expires_at: new Date(Date.now() + 60_000),
    };
    existingCode.update = vi.fn().mockImplementation(async (patch) => Object.assign(existingCode, patch));

    const masterModels = buildMasterModels({
      existingCode,
      tenant: { tenant_id: 7, db_name: "geargrid_demo", display_name: "ABC Rentals" },
    });

    const user = {
      user_id: 42,
      first_name: "Jane",
      last_name: "Doe",
      username: "jane",
      signature_url: null,
    };
    const tenantModels = buildTenantModels({
      user,
      tenantConfig: {
        business_display_name: "ABC Rentals",
        logo_url: null,
        primary_color: "#111",
        secondary_color: "#222",
      },
    });
    initTenantModels.mockReturnValue(tenantModels);

    const result = await claimPairingCode(masterModels, {
      code: "abc-def", // lowercase on purpose; service normalises
      device_id: "device-uuid-aaaaaaaa",
      device_label: "Jane's iPhone",
      user_agent: "test-ua",
    });

    expect(result.operator_device_id).toBe(1);
    expect(result.tenant_db_name).toBe("geargrid_demo");
    expect(result.operator.operator_name).toBe("Jane Doe");
    expect(result.operator.has_saved_signature).toBe(false);
    expect(result.tenant.business_display_name).toBe("ABC Rentals");
    expect(existingCode.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "CLAIMED", claimed_device_id: "device-uuid-aaaaaaaa" }),
    );
    expect(tenantModels.OperatorDevice.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 42, device_id: "device-uuid-aaaaaaaa" }),
    );
  });

  it("claimPairingCode rejects an unknown code with 404", async () => {
    const masterModels = buildMasterModels();
    await expect(
      claimPairingCode(masterModels, {
        code: "XXX-YYY",
        device_id: "device-uuid-aaaaaaaa",
      }),
    ).rejects.toThrow(/not found/);
  });

  it("claimPairingCode rejects an expired code with 410 and flips it to EXPIRED", async () => {
    const existingCode = {
      pairing_code_id: 1,
      code: "ABC-DEF",
      tenant_id: 7,
      user_id: 42,
      status: "PENDING",
      expires_at: new Date(Date.now() - 1_000),
    };
    existingCode.update = vi.fn().mockImplementation(async (patch) => Object.assign(existingCode, patch));
    const masterModels = buildMasterModels({ existingCode, tenant: { tenant_id: 7, db_name: "x" } });

    await expect(
      claimPairingCode(masterModels, { code: "ABC-DEF", device_id: "device-uuid-aaaaaaaa" }),
    ).rejects.toThrow(/expired/);
    expect(existingCode.update).toHaveBeenCalledWith({ status: "EXPIRED" });
  });

  it("claimPairingCode re-pairs an existing device to the new operator instead of erroring", async () => {
    const existingCode = {
      pairing_code_id: 1,
      code: "ABC-DEF",
      tenant_id: 7,
      user_id: 99,
      status: "PENDING",
      expires_at: new Date(Date.now() + 60_000),
    };
    existingCode.update = vi.fn().mockImplementation(async (patch) => Object.assign(existingCode, patch));
    const masterModels = buildMasterModels({
      existingCode,
      tenant: { tenant_id: 7, db_name: "geargrid_demo" },
    });
    const existingDevice = {
      operator_device_id: 1,
      user_id: 42,
      device_id: "device-uuid-aaaaaaaa",
      device_label: "old",
    };
    existingDevice.update = vi.fn().mockImplementation(async (patch) => Object.assign(existingDevice, patch));
    const tenantModels = buildTenantModels({
      existingDevice,
      user: { user_id: 99, first_name: "New", last_name: "Op", username: "new" },
      tenantConfig: null,
    });
    initTenantModels.mockReturnValue(tenantModels);

    const result = await claimPairingCode(masterModels, {
      code: "ABC-DEF",
      device_id: "device-uuid-aaaaaaaa",
      device_label: "new label",
    });

    expect(existingDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 99, device_label: "new label" }),
    );
    expect(result.operator_device_id).toBe(1);
    expect(result.operator.operator_name).toBe("New Op");
  });

  it("getDeviceStatus returns paired=false for a brand-new device_id", async () => {
    const masterModels = buildMasterModels({
      tenant: { tenant_id: 7, db_name: "geargrid_demo" },
    });
    const tenantModels = buildTenantModels();
    initTenantModels.mockReturnValue(tenantModels);

    const status = await getDeviceStatus(masterModels, "unknown-device-id-x");
    expect(status.paired).toBe(false);
    expect(status.operator).toBeNull();
  });

  it("unpairDevice reports true then false (idempotent)", async () => {
    const device = {
      operator_device_id: 1,
      user_id: 42,
      device_id: "d-1",
    };
    device.destroy = vi.fn().mockResolvedValue(undefined);
    const tenantModels = {
      OperatorDevice: {
        findOne: vi.fn().mockResolvedValueOnce(device).mockResolvedValueOnce(null),
      },
    };

    const first = await unpairDevice(tenantModels, 1, 42);
    expect(first.unpaired).toBe(true);
    expect(device.destroy).toHaveBeenCalled();

    const second = await unpairDevice(tenantModels, 1, 42);
    expect(second.unpaired).toBe(false);
  });

  it("listMyDevices returns the operator's devices only", async () => {
    const d1 = { operator_device_id: 1, user_id: 42, device_id: "a", device_label: "A", paired_at: new Date() };
    const d2 = { operator_device_id: 2, user_id: 42, device_id: "b", device_label: "B", paired_at: new Date() };
    const tenantModels = {
      OperatorDevice: { findAll: vi.fn().mockResolvedValue([d1, d2]) },
    };
    const res = await listMyDevices(tenantModels, 42);
    expect(res.devices).toHaveLength(2);
    expect(res.devices[0].operator_device_id).toBe(1);
  });
});
