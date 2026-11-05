import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ user: null, otherAdmin: null, counts: {}, globalDestroyed: [], codesDestroyed: 0 }));
vi.mock("../../src/models/master/index.js", () => ({
  getMasterModels: () => ({
    Tenant: { findByPk: async () => ({ db_name: "shop" }) },
    GlobalUser: {
      findOne: async () => ({ global_user_id: 7 }),
      destroy: async ({ where }) => db.globalDestroyed.push(where.email),
    },
    PasswordResetCode: { destroy: async () => { db.codesDestroyed++; } },
  }),
  initMasterModels: () => ({}),
}));
vi.mock("../../src/config/database.js", () => ({ getTenantConnection: async () => ({}), getCachedTenantConnection: () => ({}), masterSequelize: {} }));
const count = (name) => async () => db.counts[name] ?? 0;
const tenantModels = {
  Role: {},
  User: { findByPk: async () => db.user, findOne: async () => db.otherAdmin },
  Invoice: { unscoped: () => ({ count: count("invoices") }) },
  Payment: { count: count("payments") },
  Expense: { count: count("expenses") },
  InvoiceTrace: { count: count("traces") },
};
vi.mock("../../src/models/index.js", () => ({ initTenantModels: () => tenantModels }));

import { deleteTenantUser } from "../../src/services/superAdminTenantService.js";
import { deleteUser } from "../../src/controllers/userController.js";

const user = (over = {}) => ({ user_id: 5, email: "a@b.lk", is_active: true, Roles: [{ hierarchy_level: 20 }], update: vi.fn(async () => {}), destroy: vi.fn(async () => {}), setRoles: vi.fn(async () => {}), ...over });

beforeEach(() => {
  db.user = user();
  db.otherAdmin = { user_id: 1 };
  db.counts = {};
  db.globalDestroyed = [];
  db.codesDestroyed = 0;
});

describe("deleting a user in a shop", () => {
  const run = async (actor, id) => {
    const res = { status: vi.fn(function () { return this; }), json: vi.fn() };
    const next = vi.fn();
    await deleteUser({ params: { id }, user: { userId: actor, tenantDbName: "shop" } }, res, next);
    await new Promise((resolve) => setImmediate(resolve)); // the controller doesn't hand back its promise
    return { res, next };
  };
  it("reaches the delete, with no 'id is not defined' error", async () => {
    db.user = user({ save: vi.fn(async () => {}) });
    const { res, next } = await run(9, "5");
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.user.is_active).toBe(false);
  });
  it("still can't deactivate yourself", async () => {
    const { res } = await run(5, "5");
    expect(res.status).toHaveBeenCalledWith(403);
    expect(db.user.is_active).toBe(true);
  });
});

describe("deleting a user from the console", () => {
  it("a user with no history is removed, with their login", async () => {
    expect(await deleteTenantUser("t", 5)).toEqual({ archived: false });
    expect(db.user.destroy).toHaveBeenCalled();
    expect(db.globalDestroyed).toEqual(["a@b.lk"]);
    expect(db.codesDestroyed).toBe(1);
  });
  it.each(["invoices", "payments", "expenses", "traces"])("a user with %s stays on record but can't log in", async (kind) => {
    db.counts[kind] = 2;
    expect(await deleteTenantUser("t", 5)).toEqual({ archived: true });
    expect(db.user.destroy).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledWith({ is_active: false });
    expect(db.globalDestroyed).toEqual(["a@b.lk"]);
  });
  it("if another record still points at them, they stay on record instead of failing", async () => {
    db.user = user({ destroy: vi.fn(async () => { throw Object.assign(new Error("fk"), { name: "SequelizeForeignKeyConstraintError" }); }) });
    expect(await deleteTenantUser("t", 5)).toEqual({ archived: true });
    expect(db.user.update).toHaveBeenCalledWith({ is_active: false });
    expect(db.globalDestroyed).toEqual(["a@b.lk"]);
  });
  it("won't remove a shop's only active administrator", async () => {
    db.user = user({ Roles: [{ hierarchy_level: 100 }] });
    db.otherAdmin = null;
    await expect(deleteTenantUser("t", 5)).rejects.toThrow(/only active administrator/);
    expect(db.user.destroy).not.toHaveBeenCalled();
    expect(db.globalDestroyed).toEqual([]);
  });
  it("can remove an administrator when another remains", async () => {
    db.user = user({ Roles: [{ hierarchy_level: 100 }] });
    await expect(deleteTenantUser("t", 5)).resolves.toEqual({ archived: false });
  });
});
