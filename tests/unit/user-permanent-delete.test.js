import { describe, it, expect, vi } from "vitest";

const globalDestroy = vi.fn();
vi.mock("../../src/models/master/index.js", () => ({
  initMasterModels: () => ({ GlobalUser: { destroy: globalDestroy } }),
  getMasterModels: () => ({ GlobalUser: { destroy: globalDestroy } }),
}));
vi.mock("../../src/config/database.js", () => ({ masterSequelize: {} }));

const { permanentlyDeleteUser } = await import("../../src/services/userService.js");

const build = ({ active = false, history = 0, destroyError = null } = {}) => {
  const user = {
    user_id: 5,
    email: "a@b.com",
    is_active: active,
    setRoles: vi.fn(),
    destroy: vi.fn(async () => {
      if (destroyError) throw destroyError;
    }),
  };
  const count = async () => history;
  return {
    user,
    models: {
      User: { findByPk: async (id) => (id === 5 ? user : null) },
      Invoice: { unscoped: () => ({ count }) },
      Payment: { count },
      Expense: { count },
      InvoiceTrace: { count },
    },
  };
};

describe("permanently deleting a user", () => {
  it("rejects unknown users", async () => {
    const { models } = build();
    await expect(permanentlyDeleteUser(models, 99)).rejects.toThrow(/not found/i);
  });
  it("refuses active users", async () => {
    const { models, user } = build({ active: true });
    await expect(permanentlyDeleteUser(models, 5)).rejects.toThrow(/deactivate/i);
    expect(user.destroy).not.toHaveBeenCalled();
  });
  it("no history: removed and global login freed", async () => {
    globalDestroy.mockClear();
    const { models, user } = build();
    expect(await permanentlyDeleteUser(models, 5)).toEqual({ removed: true, archived: false });
    expect(user.setRoles).toHaveBeenCalledWith([]);
    expect(globalDestroy).toHaveBeenCalledWith({ where: { email: "a@b.com" } });
  });
  it("with history: kept on record, login untouched", async () => {
    globalDestroy.mockClear();
    const { models, user } = build({ history: 3 });
    expect(await permanentlyDeleteUser(models, 5)).toEqual({ removed: false, archived: true });
    expect(user.destroy).not.toHaveBeenCalled();
    expect(globalDestroy).not.toHaveBeenCalled();
  });
  it("foreign key error: falls back to archived", async () => {
    const { models } = build({ destroyError: Object.assign(new Error("fk"), { name: "SequelizeForeignKeyConstraintError" }) });
    expect(await permanentlyDeleteUser(models, 5)).toEqual({ removed: false, archived: true });
  });
});
