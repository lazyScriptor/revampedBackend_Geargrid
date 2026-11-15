import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreateDeviceLeadContactContract,
  CreateLeadContactContract,
  DialCallContract,
  GetDevicePolicyContract,
  ListShopDevicesContract,
  PostDeviceOpenCustomerContract,
  SearchPhoneContactsContract,
} from "@geargrid/contracts";

const state = vi.hoisted(() => ({
  tenantModels: {},
  masterModels: {},
  authUser: { tenantDbName: "geargrid_shop1", userId: 7 },
  device: { operator_device_id: 21, user_id: 7, status: "ACTIVE" },
  pushCalls: [],
  socketRooms: [],
  notifyCalls: [],
  isAdminByUserId: { 1: true, 7: true, 8: false },
}));

vi.mock("../../src/config/database.js", () => ({
  getCachedTenantConnection: (dbName) => ({ dbName }),
  masterSequelize: { query: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../../src/models/index.js", () => ({
  initTenantModels: () => state.tenantModels,
}));

vi.mock("../../src/models/master/index.js", () => ({
  getMasterModels: () => state.masterModels,
}));

vi.mock("../../src/middlewares/authMiddleware.js", () => ({
  protect: (req, _res, next) => {
    req.user = { ...state.authUser };
    next();
  },
  requirePermission: () => (_req, _res, next) => next(),
}));

vi.mock("../../src/middlewares/planMiddleware.js", () => ({
  requireFeature: () => (_req, _res, next) => next(),
}));

vi.mock("../../src/middlewares/deviceAuth.js", () => ({
  deviceAuth: (req, _res, next) => {
    req.device = state.device;
    req.deviceUser = {
      user_id: state.device.user_id,
      is_active: true,
      Roles: [
        {
          role_id: 1,
          role_name: "Staff",
          hierarchy_level: state.isAdminByUserId[state.device.user_id] ? 100 : 10,
          is_active: true,
          Permissions: [{ permission_code: "calls:view" }, { permission_code: "phone_contacts:view" }],
        },
      ],
    };
    req.tenantModels = state.tenantModels;
    req.tenantDbName = "geargrid_shop1";
    next();
  },
}));

vi.mock("../../src/services/planService.js", () => ({
  getTenantPlan: async () => ({ features: { phone_assistant: true } }),
}));

vi.mock("../../src/services/devicePushService.js", () => ({
  sendDataPush: vi.fn(async (device, data, opts) => {
    state.pushCalls.push({ device, data, opts });
    return { sent: Boolean(device?.push_token) };
  }),
  sendPushToDevice: vi.fn(async () => ({ sent: true })),
  warnIfFirebaseUnconfigured: vi.fn(),
}));

vi.mock("../../src/sockets/index.js", () => ({
  getIo: () => ({
    to: (room) => ({
      emit: (event, payload) => {
        state.socketRooms.push({ room, event, payload });
      },
    }),
  }),
}));

vi.mock("../../src/services/pushEventService.js", () => ({
  notifyEvent: vi.fn(async (...args) => {
    state.notifyCalls.push(args);
    return { sent: true };
  }),
  getUserPushPreferences: vi.fn(async () => ({ preferences: [] })),
  updateUserPushPreferences: vi.fn(async () => ({ preferences: [] })),
}));

vi.mock("../../src/services/userService.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    userHasPermission: vi.fn(async () => true),
  };
});

const { default: callRoutes } = await import("../../src/routes/callRoutes.js");
const { default: phoneContactRoutes } = await import("../../src/routes/phoneContactRoutes.js");
const { default: deviceAppRoutes } = await import("../../src/routes/deviceAppRoutes.js");
const { dialFromUserPhone } = await import("../../src/services/callLogService.js");
const {
  evaluateDeviceAppVersion,
  getDevicePolicy,
  listShopDevices,
  openCustomerOnDesktop,
} = await import("../../src/services/deviceService.js");
const {
  createLeadContact,
  searchPhoneContacts,
  syncDeviceContacts,
} = await import("../../src/services/phoneContactService.js");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/calls", callRoutes);
  app.use("/api/phone-contacts", phoneContactRoutes);
  app.use("/api/device", deviceAppRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({
      status: "fail",
      message: err.message,
      code: err.code || null,
    });
  });
  return app;
};

describe("Release 2 Slice 5 — Part D4, D5, D7, D10", () => {
  beforeEach(() => {
    state.authUser = { tenantDbName: "geargrid_shop1", userId: 7 };
    state.device = { operator_device_id: 21, user_id: 7, status: "ACTIVE" };
    state.pushCalls = [];
    state.socketRooms = [];
    state.notifyCalls = [];
    state.isAdminByUserId = { 1: true, 7: true, 8: false };
    state.masterModels = {
      PlatformConfig: {
        findByPk: vi.fn(async (key) => {
          if (key === "min_app_version") return { config_key: key, config_value: "1.2.0" };
          if (key === "latest_app_version") return { config_key: key, config_value: "1.5.0" };
          return null;
        }),
      },
    };
  });

  it("D4: dialFromUserPhone pushes { type: 'dial', phone } only to the caller's active click_to_call phones", async () => {
    state.tenantModels = {
      TenantConfig: { findOne: vi.fn().mockResolvedValue({ custom_settings: {} }) },
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 7,
          is_active: true,
          Roles: [{ role_id: 1, role_name: "Staff", hierarchy_level: 100, is_active: true, Permissions: [] }],
        }),
      },
      OperatorDevice: {
        findAll: vi.fn().mockResolvedValue([
          {
            operator_device_id: 21,
            user_id: 7,
            status: "ACTIVE",
            push_token: "fcm-token-1",
            capabilities: { click_to_call: true },
          },
          {
            operator_device_id: 22,
            user_id: 7,
            status: "ACTIVE",
            push_token: "fcm-token-2",
            capabilities: { click_to_call: false },
          },
        ]),
      },
    };

    const app = buildApp();
    const res = await request(app).post("/api/calls/dial").send({ phone: "0771234567" });
    expect(res.status).toBe(200);
    const parsed = DialCallContract.response.parse(res.body);
    expect(parsed.data).toEqual({ sent: 1, total_devices: 1, phone: "0771234567" });
    expect(state.pushCalls).toHaveLength(1);
    expect(state.pushCalls[0].device.operator_device_id).toBe(21);
    expect(state.pushCalls[0].data).toEqual({
      type: "dial",
      phone: "0771234567",
      phone_e164: "94771234567",
    });

    // Rejects with 409 if no device has click_to_call enabled
    state.tenantModels.OperatorDevice.findAll.mockResolvedValue([
      {
        operator_device_id: 22,
        user_id: 7,
        status: "ACTIVE",
        push_token: "fcm-token-2",
        capabilities: { click_to_call: false },
      },
    ]);
    await expect(
      dialFromUserPhone(state.tenantModels, "geargrid_shop1", 7, { phone: "0771234567" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("D5: openCustomerOnDesktop emits pos:open_customer to the paired user's tenant room", async () => {
    const customerRow = {
      customer_id: 42,
      first_name: "Nimal",
      last_name: "Perera",
      company_name: null,
      customer_type: "Individual",
      status: "Active",
      CustomerPhones: [{ phone_e164: "94771234567" }],
    };
    state.tenantModels = {
      CustomerPhone: {},
      Customer: {
        findByPk: vi.fn(async (id) => (Number(id) === 42 ? customerRow : null)),
      },
    };

    const app = buildApp();
    const res = await request(app)
      .post("/api/device/pos/open-customer")
      .send({ customer_id: 42, call_id: 99 });
    expect(res.status).toBe(200);
    const parsed = PostDeviceOpenCustomerContract.response.parse(res.body);
    expect(parsed.data).toEqual({ emitted: true, customer_id: 42 });

    expect(state.socketRooms).toEqual([
      {
        room: "tenant:geargrid_shop1:user:7",
        event: "pos:open_customer",
        payload: {
          customer_id: 42,
          call_id: 99,
          customer: customerRow,
        },
      },
    ]);

    await expect(
      openCustomerOnDesktop(state.tenantModels, "geargrid_shop1", state.device, {
        customer_id: 999,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("D7: unknown caller leads use source='lead' & operator_device_id=null, enforce creator/admin visibility, and survive device contact sync", async () => {
    const contactRows = [];
    const callUpdateCalls = [];
    state.tenantModels = {
      CustomerPhone: { findOne: vi.fn().mockResolvedValue(null) },
      OperatorDevice: {},
      User: {
        findByPk: vi.fn(async (id) => ({
          user_id: Number(id),
          is_active: true,
          Roles: [
            {
              role_id: 1,
              role_name: state.isAdminByUserId[Number(id)] ? "Owner" : "Cashier",
              hierarchy_level: state.isAdminByUserId[Number(id)] ? 100 : 10,
              is_active: true,
              Permissions: [],
            },
          ],
        })),
      },
      CallLog: {
        update: vi.fn(async (...args) => {
          callUpdateCalls.push(args);
          return [1];
        }),
      },
      PhoneContact: {
        findOne: vi.fn(async ({ where }) =>
          contactRows.find(
            (r) =>
              r.source === where.source &&
              r.phone_e164 === where.phone_e164 &&
              r.linked_customer_id === null,
          ) || null,
        ),
        create: vi.fn(async (values) => {
          const row = {
            ...values,
            contact_id: contactRows.length + 101,
            update: vi.fn(async (upd) => Object.assign(row, upd)),
          };
          contactRows.push(row);
          return row;
        }),
        findAll: vi.fn(async () => contactRows),
        destroy: vi.fn().mockResolvedValue(0),
        count: vi.fn().mockResolvedValue(0),
      },
    };

    const app = buildApp();
    // Staff #8 creates a lead via /api/phone-contacts/leads
    state.authUser = { tenantDbName: "geargrid_shop1", userId: 8 };
    const createRes = await request(app).post("/api/phone-contacts/leads").send({
      display_name: "Ruwan Site Lead",
      phone: "0778889999",
      note: "Needs 20 scaffolding sets next Monday",
      call_id: 55,
    });
    expect(createRes.status).toBe(200);
    const createdParsed = CreateLeadContactContract.response.parse(createRes.body);
    expect(createdParsed.data.lead).toMatchObject({
      display_name: "Ruwan Site Lead",
      phone_e164: "94778889999",
      source: "lead",
      notes: "Needs 20 scaffolding sets next Monday",
      created_by_user_id: 8,
    });
    expect(contactRows[0].operator_device_id).toBeNull();
    expect(callUpdateCalls.length).toBeGreaterThanOrEqual(1);

    // Device endpoint /api/device/leads also validates against contract
    const devLeadRes = await request(app).post("/api/device/leads").send({
      display_name: "Ruwan Site Lead",
      phone: "0778889999",
      note: "Updated note from phone",
    });
    expect(devLeadRes.status).toBe(200);
    CreateDeviceLeadContactContract.response.parse(devLeadRes.body);

    // Creator (user 8) can see the lead
    const creatorSearch = await request(app)
      .get("/api/phone-contacts")
      .query({ search: "0778889999" });
    expect(creatorSearch.status).toBe(200);
    const searchParsed = SearchPhoneContactsContract.response.parse(creatorSearch.body);
    expect(searchParsed.data.contacts).toHaveLength(1);
    expect(searchParsed.data.contacts[0].operator_device_id).toBeNull();

    // Another non-admin user (#9) cannot see user #8's lead
    state.isAdminByUserId[9] = false;
    const otherRes = await searchPhoneContacts(
      state.tenantModels,
      { search: "0778889999" },
      { userId: 9 },
    );
    expect(otherRes.contacts).toHaveLength(0);

    // Admin (#1) can see user #8's lead
    const adminRes = await searchPhoneContacts(
      state.tenantModels,
      { search: "0778889999" },
      { userId: 1 },
    );
    expect(adminRes.contacts).toHaveLength(1);

    // Full contact sync scopes destroy by operator_device_id so operator_device_id=null leads are never deleted
    await syncDeviceContacts(
      state.tenantModels,
      { operator_device_id: 21, contact_sync_enabled: true },
      { full: true, final: true, confirm_empty: true, upserts: [], deletes: [] },
    );
    expect(state.tenantModels.PhoneContact.destroy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ operator_device_id: 21 }),
      }),
    );

    // createLeadContact helper can still be invoked directly cleanly
    const extra = await createLeadContact(
      state.tenantModels,
      { display_name: "Direct Lead", phone: "0712223344" },
      { actorUser: { userId: 8 } },
    );
    expect(extra.lead.source).toBe("lead");
  });

  it("D10: reads min_app_version/latest_app_version from PlatformConfig and evaluates device version_status", async () => {
    expect(
      evaluateDeviceAppVersion("1.1.9", { min_app_version: "1.2.0", latest_app_version: "1.5.0" }),
    ).toBe("update_required");
    expect(
      evaluateDeviceAppVersion("1.2.0", { min_app_version: "1.2.0", latest_app_version: "1.5.0" }),
    ).toBe("update_available");
    expect(
      evaluateDeviceAppVersion("1.5.0", { min_app_version: "1.2.0", latest_app_version: "1.5.0" }),
    ).toBe("up_to_date");
    expect(
      evaluateDeviceAppVersion(null, { min_app_version: "1.2.0", latest_app_version: "1.5.0" }),
    ).toBe("unknown");

    const now = new Date();
    const policyModels = {
      TenantConfig: { findOne: vi.fn().mockResolvedValue({ custom_settings: {} }) },
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 7,
          first_name: "Admin",
          last_name: "User",
          is_active: true,
          Roles: [{ role_id: 1, role_name: "Owner", hierarchy_level: 100, is_active: true, Permissions: [] }],
        }),
      },
      PhoneContact: { count: vi.fn().mockResolvedValue(4) },
      CallLog: { count: vi.fn().mockResolvedValue(2) },
      OperatorDevice: {
        findAll: vi.fn().mockResolvedValue([
          {
            operator_device_id: 21,
            user_id: 7,
            device_id: "dev-1",
            device_label: "Old Phone",
            app_version: "1.1.0",
            is_native_app: true,
            status: "ACTIVE",
            paired_at: now,
            last_seen_at: now,
            capabilities: { caller_brief: true },
          },
          {
            operator_device_id: 22,
            user_id: 7,
            device_id: "dev-2",
            device_label: "Slightly Behind",
            app_version: "1.3.0",
            is_native_app: true,
            status: "ACTIVE",
            paired_at: now,
            last_seen_at: now,
            capabilities: { caller_brief: true },
          },
        ]),
      },
    };

    const devPolicy = await getDevicePolicy(policyModels, "geargrid_shop1", {
      operator_device_id: 21,
      user_id: 7,
      status: "ACTIVE",
      capabilities: { caller_brief: true },
    });
    const policyParsed = GetDevicePolicyContract.response.parse({
      status: "success",
      data: devPolicy,
    });
    expect(policyParsed.data.min_app_version).toBe("1.2.0");
    expect(policyParsed.data.latest_app_version).toBe("1.5.0");

    const listed = await listShopDevices(policyModels, "geargrid_shop1");
    const listParsed = ListShopDevicesContract.response.parse({
      status: "success",
      data: listed,
    });
    expect(listParsed.data.min_app_version).toBe("1.2.0");
    expect(listParsed.data.latest_app_version).toBe("1.5.0");
    expect(listParsed.data.devices[0].version_status).toBe("update_required");
    expect(listParsed.data.devices[0].health_warnings).toContain("update_required");
    expect(listParsed.data.devices[1].version_status).toBe("update_available");
  });
});
