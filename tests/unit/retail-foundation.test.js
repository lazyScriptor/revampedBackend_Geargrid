import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { Op } from "sequelize";

// Mock Socket.IO emitters so tests never require a live socket server
const emitToTenantMock = vi.fn();
const emitToUserMock = vi.fn();
vi.mock("../../src/sockets/emitters.js", () => ({
  emitToTenant: (...args) => emitToTenantMock(...args),
  emitToUser: (...args) => emitToUserMock(...args),
}));

import {
  DEFAULT_RETAIL_SETTINGS,
  getRetailSettings,
  updateRetailSettings,
  ensureWalkInCustomer,
  setMyApprovalPin,
  approveHere,
  requestRemoteApproval,
  decideApprovalRequest,
  recordCounterException,
  getApprovalDesk,
  consumeApprovalToken,
  sha256Hex,
  hashContext,
  clearRequesterFailureLimiter,
} from "../../src/modules/retail/index.js";
import { up as migrationUp } from "../../migrations/tenant/20261123200000-retail-foundation.js";
import { getAllCustomers, getParentOptions } from "../../src/services/customerService.js";
import { findCustomerIdsBySearch } from "../../src/utils/customerSearch.js";
import { buildBriefs } from "../../src/services/customerBriefService.js";
import { syncCustomerPhones } from "../../src/services/customerPhoneService.js";
import { composeMessage as composeWhatsapp, logMessage as logWhatsapp } from "../../src/services/whatsappService.js";
import { idempotency } from "../../src/middlewares/idempotency.js";
import { getMyUiPreferences, setMyUiPreference } from "../../src/services/meService.js";
import {
  PAYMENT_METHODS,
  normalizePaymentMethod,
  isCash,
} from "../../src/config/paymentMethods.js";

const makeModelInstance = (initial) => {
  const row = { ...initial };
  row.update = vi.fn(async (patch) => {
    Object.assign(row, patch);
    return row;
  });
  row.destroy = vi.fn(async () => {});
  row.get = () => ({ ...row });
  return row;
};

describe("Retail R0 Foundations", () => {
  beforeEach(() => {
    emitToTenantMock.mockReset();
    emitToUserMock.mockReset();
    clearRequesterFailureLimiter();
  });

  describe("Migration idempotency", () => {
    it("runs up() twice without error and skips already-created tables/columns/rows", async () => {
      const tables = new Set(["INVOICES", "CUSTOMERS", "USERS", "PERMISSIONS", "ROLE_PERMISSIONs", "ROLES"]);
      const columns = {
        INVOICES: { invoice_id: {}, sub_total: {} },
        CUSTOMERS: { customer_id: {} },
        USERS: { user_id: {} },
      };
      const indexes = {};
      const permRows = [];
      const rolePermRows = [];
      const customerRows = [];

      const qi = {
        showAllTables: vi.fn(async () => [...tables]),
        describeTable: vi.fn(async (t) => columns[t] || {}),
        addColumn: vi.fn(async (t, col, def) => {
          columns[t] = columns[t] || {};
          columns[t][col] = def;
        }),
        createTable: vi.fn(async (t, cols) => {
          tables.add(t);
          columns[t] = cols;
        }),
        showIndex: vi.fn(async (t) => indexes[t] || []),
        addIndex: vi.fn(async (t, fields, opts) => {
          indexes[t] = indexes[t] || [];
          indexes[t].push({ name: opts?.name, fields: fields.map((attribute) => ({ attribute })) });
        }),
        sequelize: {
          query: vi.fn(async (sql, opts = {}) => {
            if (sql === "SHOW TABLES") {
              return [[...tables].map((t) => ({ table: t }))];
            }
            if (sql.startsWith("UPDATE `INVOICES`")) return [[]];
            if (sql.includes("SELECT permission_id FROM")) {
              const code = opts.replacements[0];
              const found = permRows.find((p) => p.permission_code === code);
              return [found ? [found] : []];
            }
            if (sql.includes("INSERT INTO `PERMISSIONS`")) {
              const id = permRows.length + 1;
              permRows.push({ permission_id: id, permission_code: opts.replacements[0] });
              return [id];
            }
            if (sql.includes("SELECT role_id FROM `ROLES`")) {
              return [[{ role_id: 1 }]];
            }
            if (sql.includes("SELECT 1 FROM `ROLE_PERMISSIONs`")) {
              const [role_id, permission_id] = opts.replacements;
              const found = rolePermRows.find((r) => r.role_id === role_id && r.permission_id === permission_id);
              return [found ? [{ 1: 1 }] : []];
            }
            if (sql.includes("INSERT INTO `ROLE_PERMISSIONs`")) {
              const [role_id, permission_id] = opts.replacements;
              rolePermRows.push({ role_id, permission_id });
              return [1];
            }
            if (sql.includes("SELECT customer_id FROM `CUSTOMERS`")) {
              return [customerRows.length ? [customerRows[0]] : []];
            }
            if (sql.includes("INSERT INTO `CUSTOMERS`")) {
              customerRows.push({ customer_id: 1, is_walk_in: 1, nic_number: "WALK-IN" });
              return [1];
            }
            return [[]];
          }),
        },
      };

      await migrationUp({ context: qi });
      const firstCreateCount = qi.createTable.mock.calls.length;
      const firstPermCount = permRows.length;
      const firstWalkInCount = customerRows.length;

      await migrationUp({ context: qi });
      expect(qi.createTable.mock.calls.length).toBe(firstCreateCount);
      expect(permRows.length).toBe(firstPermCount);
      expect(permRows.map((p) => p.permission_code)).not.toContain("retail:approve");
      expect(customerRows.length).toBe(firstWalkInCount);
    });
  });

  describe("Retail settings defaults and validation", () => {
    it("returns plan defaults when TenantConfig has no retail settings", async () => {
      const models = {
        TenantConfig: {
          findOne: vi.fn(async () => null),
        },
      };
      const settings = await getRetailSettings(models);
      expect(settings).toEqual(DEFAULT_RETAIL_SETTINGS);
      expect(settings.approvalMethod).toBe("either");
      expect(settings.approvalGrantMinutes).toBe(0);
      expect(settings.askManagerRemote).toBe(true);
      expect(settings.negativeStock).toBe("warn");
      expect(settings.discountLimitPct).toBe(10);
      expect(settings.exceptions.price_change).toBe("approve");
      expect(settings.exceptions.unlisted_item).toBe("record");
    });

    it("validates and merges retail settings updates", async () => {
      const configRow = makeModelInstance({ custom_settings: {} });
      const models = {
        TenantConfig: {
          findOne: vi.fn(async () => configRow),
        },
      };

      const updated = await updateRetailSettings(models, {
        negativeStock: "block",
        approvalMethod: "pin",
        discountLimitPct: 15,
        exceptions: { below_cost: "approve" },
      });
      expect(updated.negativeStock).toBe("block");
      expect(updated.approvalMethod).toBe("pin");
      expect(updated.discountLimitPct).toBe(15);
      expect(updated.exceptions.below_cost).toBe("approve");
      expect(updated.exceptions.price_change).toBe("approve");

      await expect(
        updateRetailSettings(models, { negativeStock: "allow" }),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        updateRetailSettings(models, { approvalGrantMinutes: 99 }),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        updateRetailSettings(models, { exceptions: { bogus_type: "record" } }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe("Approval PIN, approve-here, lockout, and token lifecycle", () => {
    const setupApprovalModels = async () => {
      const cashierPassHash = await bcrypt.hash("cashierPass1", 4);
      const managerPassHash = await bcrypt.hash("mgrPass1", 4);
      const managerPinHash = await bcrypt.hash("2580", 4);

      const cashier = makeModelInstance({
        user_id: 10,
        username: "cashier",
        first_name: "Nimal",
        last_name: "Perera",
        is_active: true,
        password_hash: cashierPassHash,
        approval_pin_hash: null,
        pin_failed_count: 0,
        pin_locked_until: null,
        Roles: [{ role_id: 2, role_name: "Cashier", hierarchy_level: 10, Permissions: [] }],
      });

      const manager = makeModelInstance({
        user_id: 20,
        username: "manager",
        first_name: "Kamal",
        last_name: "Silva",
        is_active: true,
        password_hash: managerPassHash,
        approval_pin_hash: managerPinHash,
        pin_failed_count: 0,
        pin_locked_until: null,
        Roles: [
          {
            role_id: 1,
            role_name: "Manager",
            hierarchy_level: 50,
            Permissions: [{ permission_code: "approvals:decide" }],
          },
        ],
      });

      const users = [cashier, manager];
      const exceptions = [];
      const tokens = new Map();
      const notifications = [];

      const models = {
        TenantConfig: { findOne: vi.fn(async () => null) },
        User: {
          findByPk: vi.fn(async (id) => users.find((u) => u.user_id === Number(id)) || null),
          findAll: vi.fn(async () => users.filter((u) => u.is_active)),
        },
        UserPermissionOverride: { findAll: vi.fn(async () => []) },
        CounterException: {
          create: vi.fn(async (data) => {
            const rec = makeModelInstance({ exception_id: exceptions.length + 1, ...data });
            exceptions.push(rec);
            return rec;
          }),
          findByPk: vi.fn(async (id) => exceptions.find((e) => e.exception_id === Number(id)) || null),
          update: vi.fn(async (patch, { where }) => {
            const rec = exceptions.find((e) => e.exception_id === Number(where.exception_id));
            if (!rec || rec.status !== where.status) return [0];
            if (where[Op.or]) {
              const notExpired = where[Op.or].some((cond) => {
                if (cond.expires_at === null) return rec.expires_at === null || rec.expires_at === undefined;
                if (cond.expires_at?.[Op.gt]) return rec.expires_at && new Date(rec.expires_at) > cond.expires_at[Op.gt];
                return false;
              });
              if (!notExpired) return [0];
            }
            Object.assign(rec, patch);
            return [1];
          }),
          findAndCountAll: vi.fn(async ({ where }) => {
            const filtered = exceptions.filter((e) => {
              if (where.status === "waiting") {
                if (e.status !== "waiting") return false;
                if (where[Op.or]) {
                  const notExpired = where[Op.or].some((cond) => {
                    if (cond.expires_at === null) return e.expires_at === null || e.expires_at === undefined;
                    if (cond.expires_at?.[Op.gt]) return e.expires_at && new Date(e.expires_at) > cond.expires_at[Op.gt];
                    return false;
                  });
                  if (!notExpired) return false;
                }
                return true;
              }
              if (where.status && where.status[Op.ne] === "waiting") return e.status !== "waiting";
              return true;
            });
            return { count: filtered.length, rows: filtered };
          }),
          findAll: vi.fn(async ({ where }) => {
            return exceptions.filter((e) => {
              if (where.status && where.status[Op.ne] === "waiting") return e.status !== "waiting";
              return true;
            });
          }),
        },
        ApprovalToken: {
          create: vi.fn(async (data) => {
            const rec = makeModelInstance(data);
            tokens.set(data.token_hash, rec);
            return rec;
          }),
          findByPk: vi.fn(async (hash) => tokens.get(hash) || null),
          update: vi.fn(async (patch, { where }) => {
            const rec = tokens.get(where.token_hash);
            if (!rec || rec.used_at !== null) return [0];
            if (where.expires_at?.[Op.gt] && !(new Date(rec.expires_at) > where.expires_at[Op.gt])) {
              return [0];
            }
            Object.assign(rec, patch);
            return [1];
          }),
        },
        Notification: {
          create: vi.fn(async (data) => {
            notifications.push(data);
            return data;
          }),
        },
      };

      return { models, cashier, manager, exceptions, tokens, notifications };
    };

    it("sets PIN with valid password and rejects invalid password or non-4..6 digit PIN", async () => {
      const { models, cashier } = await setupApprovalModels();

      await expect(
        setMyApprovalPin(models, cashier.user_id, { current_password: "wrong", pin: "1234" }),
      ).rejects.toMatchObject({ statusCode: 401 });

      await expect(
        setMyApprovalPin(models, cashier.user_id, { current_password: "cashierPass1", pin: "12a4" }),
      ).rejects.toMatchObject({ statusCode: 400 });

      await setMyApprovalPin(models, cashier.user_id, { current_password: "cashierPass1", pin: "4321" });
      expect(cashier.approval_pin_hash).toBeTruthy();
      expect(await bcrypt.compare("4321", cashier.approval_pin_hash)).toBe(true);
    });

    it("locks manager PIN for 10 minutes after 5 wrong attempts", async () => {
      const { models, manager } = await setupApprovalModels();
      const now = new Date("2026-11-23T10:00:00Z");

      for (let i = 1; i <= 5; i++) {
        await expect(
          approveHere(
            models,
            10,
            { type: "price_change", context: { product_id: 1 }, approver_user_id: manager.user_id, pin: "0000" },
            { now },
          ),
        ).rejects.toMatchObject({ statusCode: 401 });
        expect(manager.pin_failed_count).toBe(i);
      }

      expect(manager.pin_locked_until).toBeInstanceOf(Date);
      expect(manager.pin_locked_until.getTime()).toBe(now.getTime() + 10 * 60 * 1000);

      // Even the correct PIN is refused while locked
      await expect(
        approveHere(
          models,
          10,
          { type: "price_change", context: { product_id: 1 }, approver_user_id: manager.user_id, pin: "2580" },
          { now: new Date(now.getTime() + 60_000) },
        ),
      ).rejects.toMatchObject({ statusCode: 423 });
    });

    it("locks manager PIN atomically under 20 concurrent wrong attempts", async () => {
      const { models, manager } = await setupApprovalModels();
      const now = new Date("2026-11-23T10:00:00Z");

      // Simulate atomic SQL UPDATE on USERS even when all 20 callers read pin_failed_count=0 first
      models.sequelize = {
        query: vi.fn(async (sql, { replacements }) => {
          if (sql.includes("UPDATE `USERS`")) {
            const [maxAttempts, ts] = replacements;
            const nextCount = Number(manager.pin_failed_count || 0) + 1;
            if (nextCount >= maxAttempts && !manager.pin_locked_until) {
              manager.pin_locked_until = new Date(new Date(ts).getTime() + 10 * 60 * 1000);
            }
            manager.pin_failed_count = nextCount;
          }
          return [[]];
        }),
      };

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          approveHere(
            models,
            10,
            { type: "price_change", context: { product_id: 1 }, approver_user_id: manager.user_id, pin: "0000" },
            { now },
          ),
        ),
      );

      expect(results.every((r) => r.status === "rejected")).toBe(true);
      expect(manager.pin_failed_count).toBe(20);
      expect(manager.pin_locked_until).toBeInstanceOf(Date);
      expect(manager.pin_locked_until.getTime()).toBe(now.getTime() + 10 * 60 * 1000);
    });

    it("locks password approval after 5 failures and enforces per-requester 429 limit after 10 failures", async () => {
      const { models, manager } = await setupApprovalModels();
      const now = new Date("2026-11-23T10:00:00Z");

      // 5 wrong passwords lock the manager
      for (let i = 1; i <= 5; i++) {
        await expect(
          approveHere(
            models,
            10,
            { type: "price_change", context: { product_id: 1 }, approver_user_id: manager.user_id, password: "wrong" },
            { now },
          ),
        ).rejects.toMatchObject({ statusCode: 401 });
      }
      await expect(
        approveHere(
          models,
          10,
          { type: "price_change", context: { product_id: 1 }, approver_user_id: manager.user_id, password: "mgrPass1" },
          { now: new Date(now.getTime() + 60_000) },
        ),
      ).rejects.toMatchObject({ statusCode: 423 });

      // Reset manager lock and test per-requester 10-failure limit
      manager.pin_failed_count = 0;
      manager.pin_locked_until = null;
      clearRequesterFailureLimiter();

      for (let i = 1; i <= 10; i++) {
        // Reset manager every 4 attempts so manager lock doesn't trigger before requester limit
        if (i % 4 === 0) manager.pin_failed_count = 0;
        await expect(
          approveHere(
            models,
            10,
            { type: "price_change", context: { product_id: 1 }, approver_user_id: manager.user_id, password: "wrong" },
            { now },
          ),
        ).rejects.toMatchObject({ statusCode: 401 });
      }

      // 11th attempt from requester 10 is rejected with 429 even with correct password
      await expect(
        approveHere(
          models,
          10,
          { type: "price_change", context: { product_id: 1 }, approver_user_id: manager.user_id, password: "mgrPass1" },
          { now },
        ),
      ).rejects.toMatchObject({ statusCode: 429 });
    });

    it("refuses self-approval and enforces single-use, expiry, type and context on tokens", async () => {
      const { models, manager, tokens } = await setupApprovalModels();
      const now = new Date("2026-11-23T10:00:00Z");

      // Self-approval refused
      await expect(
        approveHere(
          models,
          manager.user_id,
          { type: "price_change", context: { product_id: 1 }, approver_user_id: manager.user_id, pin: "2580" },
          { now },
        ),
      ).rejects.toMatchObject({ statusCode: 403 });

      // Cashier cannot approve because lacks approvals:decide
      await expect(
        approveHere(
          models,
          manager.user_id,
          { type: "price_change", context: { product_id: 1 }, approver_user_id: 10, password: "cashierPass1" },
          { now },
        ),
      ).rejects.toMatchObject({ statusCode: 403 });

      const context = { product_id: 5, new_price: 900 };
      const res = await approveHere(
        models,
        10,
        { type: "price_change", context, summary: "Price 1000 -> 900", approver_user_id: manager.user_id, pin: "2580" },
        { now },
      );

      expect(res.approval_token).toBeTruthy();
      expect(tokens.has(sha256Hex(res.approval_token))).toBe(true);
      expect(tokens.get(sha256Hex(res.approval_token)).context_hash).toBe(hashContext(context));

      // Wrong type rejected
      await expect(
        consumeApprovalToken(models, res.approval_token, { type: "discount_over_limit", context, userId: 10, now }),
      ).rejects.toMatchObject({ statusCode: 403 });

      // Wrong context rejected
      await expect(
        consumeApprovalToken(models, res.approval_token, { type: "price_change", context: { product_id: 5, new_price: 500 }, userId: 10, now }),
      ).rejects.toMatchObject({ statusCode: 403 });

      // Expired token rejected
      await expect(
        consumeApprovalToken(models, res.approval_token, {
          type: "price_change",
          context,
          userId: 10,
          now: new Date(now.getTime() + 61_000),
        }),
      ).rejects.toMatchObject({ statusCode: 403 });

      // Valid consumption succeeds once, then second use fails with 409
      await consumeApprovalToken(models, res.approval_token, { type: "price_change", context, userId: 10, now });
      await expect(
        consumeApprovalToken(models, res.approval_token, { type: "price_change", context, userId: 10, now }),
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it("allows only one winner when two concurrent consumeApprovalToken calls race", async () => {
      const { models, manager } = await setupApprovalModels();
      const now = new Date("2026-11-23T10:00:00Z");
      const context = { product_id: 8, new_price: 450 };

      const res = await approveHere(
        models,
        10,
        { type: "price_change", context, approver_user_id: manager.user_id, pin: "2580" },
        { now },
      );

      const [r1, r2] = await Promise.allSettled([
        consumeApprovalToken(models, res.approval_token, { type: "price_change", context, userId: 10, now }),
        consumeApprovalToken(models, res.approval_token, { type: "price_change", context, userId: 10, now }),
      ]);

      const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
      const rejected = [r1, r2].filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.statusCode).toBe(409);
    });

    it("supports remote request -> decide -> token, record-only, and desk totals", async () => {
      const { models, manager, notifications } = await setupApprovalModels();
      const ctx = { discount_pct: 20 };

      const reqRes = await requestRemoteApproval(
        models,
        10,
        { type: "discount_over_limit", context: ctx, summary: "20% discount", amount_impact: 500 },
        { tenantDbName: "geargrid_demo" },
      );
      expect(reqRes.status).toBe("waiting");
      expect(emitToTenantMock).toHaveBeenCalledWith(
        "geargrid_demo",
        "approval:requested",
        expect.objectContaining({ exception_id: reqRes.exception_id, type: "discount_over_limit" }),
      );
      expect(notifications).toHaveLength(1);
      expect(notifications[0].user_id).toBe(manager.user_id);

      const decideRes = await decideApprovalRequest(
        models,
        reqRes.exception_id,
        manager.user_id,
        { approve: true },
        { tenantDbName: "geargrid_demo" },
      );
      expect(decideRes.approved).toBe(true);
      expect(decideRes.approval_token).toBeTruthy();
      expect(emitToUserMock).toHaveBeenCalledWith(
        "geargrid_demo",
        10,
        "approval:decided",
        expect.objectContaining({ exception_id: reqRes.exception_id, approved: true }),
      );

      await consumeApprovalToken(models, decideRes.approval_token, {
        type: "discount_over_limit",
        context: ctx,
        userId: 10,
      });

      // Record-only exception
      const recRes = await recordCounterException(models, 10, {
        type: "below_cost",
        context: { product_id: 9 },
        summary: "Sold below cost",
        amount_impact: 125.5,
      });
      expect(recRes.exception.status).toBe("recorded");

      const desk = await getApprovalDesk(models, { tab: "records" });
      expect(desk.total).toBe(2);
      expect(desk.totals).toEqual(
        expect.arrayContaining([
          { type: "discount_over_limit", count: 1, amount_impact: 500 },
          { type: "below_cost", count: 1, amount_impact: 125.5 },
        ]),
      );
    });

    it("allows only one manager to win when two concurrent decideApprovalRequest calls race", async () => {
      const { models, manager, tokens } = await setupApprovalModels();
      const now = new Date("2026-11-23T10:00:00Z");

      const reqRes = await requestRemoteApproval(
        models,
        10,
        { type: "price_change", context: { product_id: 2 }, summary: "Race test" },
        { tenantDbName: "geargrid_demo", now },
      );

      const [d1, d2] = await Promise.allSettled([
        decideApprovalRequest(models, reqRes.exception_id, manager.user_id, { approve: true }, { tenantDbName: "geargrid_demo", now }),
        decideApprovalRequest(models, reqRes.exception_id, manager.user_id, { approve: false }, { tenantDbName: "geargrid_demo", now }),
      ]);

      const fulfilled = [d1, d2].filter((r) => r.status === "fulfilled");
      const rejected = [d1, d2].filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.statusCode).toBe(409);
      expect(tokens.size).toBe(1);
    });

    it("excludes expired waiting requests from getApprovalDesk tab=waiting", async () => {
      const { models } = await setupApprovalModels();
      const t0 = new Date("2026-11-23T10:00:00Z");

      await requestRemoteApproval(
        models,
        10,
        { type: "price_change", context: { product_id: 1 }, summary: "Expired one" },
        { tenantDbName: "geargrid_demo", now: t0 },
      );

      // 4 minutes later -> still waiting
      const stillActive = await getApprovalDesk(models, {
        tab: "waiting",
        now: new Date(t0.getTime() + 4 * 60 * 1000),
      });
      expect(stillActive.total).toBe(1);

      // 6 minutes later -> expired (> 5 min TTL), excluded from waiting tab
      const afterExpiry = await getApprovalDesk(models, {
        tab: "waiting",
        now: new Date(t0.getTime() + 6 * 60 * 1000),
      });
      expect(afterExpiry.total).toBe(0);
      expect(afterExpiry.items).toHaveLength(0);
    });
  });

  describe("Walk-in customer exclusions & ensureWalkInCustomer", () => {
    it("excludes walk-in from customer lists, search, briefs, phone indexing, and rejects WhatsApp with 422", async () => {
      const findAllMock = vi.fn(async () => []);
      const findAndCountAllMock = vi.fn(async () => ({ count: 0, rows: [] }));
      const models = {
        Customer: {
          findAll: findAllMock,
          findAndCountAll: findAndCountAllMock,
          findByPk: vi.fn(async () => ({ customer_id: 99, is_walk_in: true, nic_number: "WALK-IN" })),
          findOne: vi.fn(async () => null),
          create: vi.fn(async (data) => makeModelInstance({ customer_id: 99, ...data })),
        },
        CustomerPhone: {
          destroy: vi.fn(async () => {}),
          bulkCreate: vi.fn(async () => {}),
        },
        PhoneContact: { update: vi.fn(async () => {}) },
      };

      await getAllCustomers(models, {});
      expect(findAndCountAllMock.mock.calls[0][0].where.is_walk_in).toEqual({ [Op.not]: true });

      await getAllCustomers(models, { skip_count: "true" });
      expect(findAllMock.mock.calls[0][0].where.is_walk_in).toEqual({ [Op.not]: true });

      await getParentOptions(models, {});
      expect(findAllMock.mock.calls[1][0].where.is_walk_in).toEqual({ [Op.not]: true });

      await findCustomerIdsBySearch(models, "Walk");
      expect(findAllMock.mock.calls[2][0].where.is_walk_in).toEqual({ [Op.not]: true });

      await buildBriefs(models, [99]);
      expect(findAllMock.mock.calls[3][0].where.is_walk_in).toEqual({ [Op.not]: true });

      // Phone indexing skips walk-in customer
      await syncCustomerPhones(models, { customer_id: 99, is_walk_in: true, phone_number: "0000000000" });
      expect(models.CustomerPhone.bulkCreate).not.toHaveBeenCalled();

      // WhatsApp refuses walk-in with 422
      await expect(
        composeWhatsapp(models, { customer_id: 99, template_key: "custom", custom_text: "hi" }),
      ).rejects.toMatchObject({ statusCode: 422 });
      await expect(
        logWhatsapp(models, { customer_id: 99, template_key: "custom", body: "hi" }),
      ).rejects.toMatchObject({ statusCode: 422 });

      // ensureWalkInCustomer creates lazily when missing
      const walkIn = await ensureWalkInCustomer(models);
      expect(walkIn.is_walk_in).toBe(true);
      expect(walkIn.nic_number).toBe("WALK-IN");
      expect(walkIn.phone_number).toBe("0000000000");
    });
  });

  describe("Idempotency middleware", () => {
    const makeIdempotencyStore = () => {
      const store = [];
      const IdempotencyKey = {
        findOne: vi.fn(async ({ where }) =>
          store.find((r) => r.key === where.key && r.user_id === where.user_id && r.route === where.route) || null,
        ),
        create: vi.fn(async (data) => {
          const dup = store.find((r) => r.key === data.key && r.user_id === data.user_id && r.route === data.route);
          if (dup) {
            const err = new Error("Duplicate entry");
            err.name = "SequelizeUniqueConstraintError";
            throw err;
          }
          const rec = makeModelInstance(data);
          store.push(rec);
          return rec;
        }),
        update: vi.fn(async (patch, { where }) => {
          const rec = store.find(
            (r) =>
              r.key === where.key &&
              r.user_id === where.user_id &&
              r.route === where.route &&
              r.response_status === where.response_status,
          );
          if (!rec) return [0];
          Object.assign(rec, patch);
          return [1];
        }),
        destroy: vi.fn(async ({ where }) => {
          const idx = store.findIndex(
            (r) =>
              r.key === where.key &&
              r.user_id === where.user_id &&
              r.route === where.route &&
              (where.response_status === undefined || r.response_status === where.response_status),
          );
          if (idx >= 0) {
            store.splice(idx, 1);
            return 1;
          }
          return 0;
        }),
      };
      return { store, models: { IdempotencyKey } };
    };

    it("passes through with no header, replays on repeat, and returns 409 on payload conflict", async () => {
      const { store, models } = makeIdempotencyStore();
      const mw = idempotency({ resolveModels: () => models });

      // 1. No header -> passes through
      const nextNoHeader = vi.fn();
      await mw({ headers: {}, method: "POST", baseUrl: "/api", path: "/invoices", user: { userId: 1 }, body: {} }, {}, nextNoHeader);
      expect(nextNoHeader).toHaveBeenCalledWith();

      // 2. First request with header -> reserves key, executes handler & stores 201 response
      const res1 = {
        statusCode: 201,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json: vi.fn(function (b) { return b; }),
      };
      const next1 = vi.fn();
      await mw(
        {
          headers: { "idempotency-key": "abc-123" },
          method: "POST",
          baseUrl: "/api",
          path: "/invoices",
          user: { userId: 1 },
          body: { customer_id: 5, items: [1] },
        },
        res1,
        next1,
      );
      expect(next1).toHaveBeenCalledWith();
      res1.json({ status: "success", invoice_id: 42 });
      await Promise.resolve();
      expect(store).toHaveLength(1);
      expect(store[0].response_status).toBe(201);

      // 3. Repeat with same key and same body -> replays stored response without calling next
      const res2 = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json: vi.fn((b) => b),
      };
      const next2 = vi.fn();
      await mw(
        {
          headers: { "idempotency-key": "abc-123" },
          method: "POST",
          baseUrl: "/api",
          path: "/invoices",
          user: { userId: 1 },
          body: { items: [1], customer_id: 5 },
        },
        res2,
        next2,
      );
      expect(next2).not.toHaveBeenCalled();
      expect(res2.statusCode).toBe(201);
      expect(res2.json).toHaveBeenCalledWith({ status: "success", invoice_id: 42 });

      // 4. Same key with different body -> 409 conflict
      const next3 = vi.fn();
      await mw(
        {
          headers: { "idempotency-key": "abc-123" },
          method: "POST",
          baseUrl: "/api",
          path: "/invoices",
          user: { userId: 1 },
          body: { customer_id: 99, items: [1] },
        },
        {},
        next3,
      );
      expect(next3).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
    });

    it("stops concurrent identical double-submits so the handler runs once, and cleans up non-2xx reservations", async () => {
      const { store, models } = makeIdempotencyStore();
      const mw = idempotency({ resolveModels: () => models });

      let handlerRuns = 0;
      const runRequest = async (key, statusCode) => {
        const res = {
          statusCode,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json: vi.fn((b) => b),
        };
        let nextErr = null;
        let calledNext = false;
        await mw(
          {
            headers: { "idempotency-key": key },
            method: "POST",
            baseUrl: "/api",
            path: "/invoices",
            user: { userId: 1 },
            body: { customer_id: 5 },
          },
          res,
          (err) => {
            if (err) nextErr = err;
            else {
              calledNext = true;
              handlerRuns += 1;
            }
          },
        );
        return { res, nextErr, calledNext };
      };

      // Two concurrent identical requests while first hasn't finished yet
      const [r1, r2] = await Promise.all([
        runRequest("race-key", 201),
        runRequest("race-key", 201),
      ]);
      expect(handlerRuns).toBe(1);
      const errors = [r1.nextErr, r2.nextErr].filter(Boolean);
      expect(errors).toHaveLength(1);
      expect(errors[0].statusCode).toBe(409);
      expect(errors[0].message).toMatch(/already in progress/i);

      // Non-2xx response deletes reservation so a retry can succeed
      const failRun = await runRequest("retry-key", 422);
      expect(failRun.calledNext).toBe(true);
      failRun.res.json({ status: "fail" });
      await Promise.resolve();
      expect(store.find((r) => r.key === "retry-key")).toBeUndefined();

      const retryRun = await runRequest("retry-key", 201);
      expect(retryRun.calledNext).toBe(true);
    });
  });

  describe("UI preferences & Payment methods", () => {
    it("stores/reads per-user UI preferences and enforces 32 KB limit", async () => {
      const rows = [];
      const models = {
        UserUiPreference: {
          findAll: vi.fn(async ({ where }) => rows.filter((r) => r.user_id === where.user_id)),
          upsert: vi.fn(async (data) => {
            const idx = rows.findIndex((r) => r.user_id === data.user_id && r.pref_key === data.pref_key);
            if (idx >= 0) rows[idx] = data;
            else rows.push(data);
          }),
        },
      };

      await setMyUiPreference(models, 7, "pos.density", { compact: true });
      const res = await getMyUiPreferences(models, 7);
      expect(res.preferences["pos.density"]).toEqual({ compact: true });

      const oversized = "x".repeat(33 * 1024);
      await expect(
        setMyUiPreference(models, 7, "pos.big", oversized),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("lists canonical payment methods and maps legacy Transfer to Bank Transfer", () => {
      expect(PAYMENT_METHODS).toEqual([
        "Cash",
        "Card",
        "Bank Transfer",
        "Cheque",
        "Online",
        "WalletDeposit",
      ]);
      expect(normalizePaymentMethod("Transfer")).toBe("Bank Transfer");
      expect(normalizePaymentMethod("Bank Transfer")).toBe("Bank Transfer");
      expect(isCash("Cash")).toBe(true);
      expect(isCash("Card")).toBe(false);
    });
  });
});
