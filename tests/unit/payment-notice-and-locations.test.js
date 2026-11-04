import { describe, it, expect, vi } from "vitest";
import { DEFAULT_NOTICE, buildShopNotice, isPaymentLocked, normalizeNoticeDefaults, resolveNotice } from "../../src/config/paymentNotice.js";
import { deleteWarehouse } from "../../src/services/warehouseService.js";

const NOW = new Date("2026-11-05T10:00:00Z");
const defaults = normalizeNoticeDefaults(null);

describe("payment notice rules", () => {
  it("cleans console defaults; blank timer means default, null means never lock", () => {
    const d = normalizeNoticeDefaults({ message_en: "  Pay  ", grace_days: null, repeat_minutes: "abc", wait_seconds: 999 });
    expect(d).toMatchObject({ message_en: "Pay", grace_days: null, repeat_minutes: 60, wait_seconds: 10, message_si: DEFAULT_NOTICE.message_si });
    expect(normalizeNoticeDefaults({ grace_days: 0 }).grace_days).toBe(0);
  });
  it("a newly overdue shop gets the default timer", () => {
    const n = buildShopNotice({}, defaults, null, NOW);
    expect(n.overdue_since).toBe(NOW.toISOString());
    expect(n.lock_at).toBe("2026-11-12T10:00:00.000Z");
  });
  it("defaults can mean never lock, and a shop can have its own date", () => {
    expect(buildShopNotice({}, { ...defaults, grace_days: null }, null, NOW).lock_at).toBeNull();
    expect(buildShopNotice({ lock_at: "2026-12-01T00:00:00Z" }, defaults, null, NOW).lock_at).toBe("2026-12-01T00:00:00.000Z");
    expect(buildShopNotice({ lock_at: null }, defaults, null, NOW).lock_at).toBeNull();
  });
  it("changing a shop's wording keeps its timer and overdue date", () => {
    const first = buildShopNotice({}, defaults, null, new Date("2026-11-01T00:00:00Z"));
    const again = buildShopNotice({ message_en: "New" }, defaults, first, NOW);
    expect(again.overdue_since).toBe(first.overdue_since);
    expect(again.lock_at).toBe(first.lock_at);
    expect(again.message_en).toBe("New");
  });
  it("a bad date doesn't remove the timer", () => {
    const first = buildShopNotice({}, defaults, null, NOW);
    expect(buildShopNotice({ lock_at: "nonsense" }, defaults, first, NOW).lock_at).toBe(first.lock_at);
  });
  it("locks only when overdue and past the timer", () => {
    const n = { overdue_since: "2026-11-01", lock_at: "2026-11-06T00:00:00Z" };
    expect(isPaymentLocked("Overdue", n, NOW.getTime())).toBe(false);
    expect(isPaymentLocked("Overdue", n, new Date("2026-11-06T00:00:01Z").getTime())).toBe(true);
    expect(isPaymentLocked("Overdue", { overdue_since: "2026-11-01", lock_at: null }, NOW.getTime())).toBe(false);
    expect(isPaymentLocked("Active", n, new Date("2027-01-01").getTime())).toBe(false);
  });
  it("a shop marked overdue before timers existed stays locked", () => {
    expect(isPaymentLocked("Overdue", null, NOW.getTime())).toBe(true);
    expect(resolveNotice({ status: "Overdue", notice: null, defaults }, NOW.getTime()).locked).toBe(true);
  });
  it("gives the app what it shows; a shop's own words beat the defaults", () => {
    const r = resolveNotice({ status: "Overdue", notice: { overdue_since: "2026-11-01T10:00:00Z", lock_at: null, message_en: "Own" }, defaults, displayName: "Shop", monthlyRate: "5900.00", nextBillingDate: "2026-11-01" }, NOW.getTime());
    expect(r).toMatchObject({ days_overdue: 4, amount: 5900, shop: "Shop", message_en: "Own", message_si: defaults.message_si, repeat_minutes: 60, locked: false });
    expect(resolveNotice({ status: "Active", notice: {}, defaults })).toBeNull();
  });
});

describe("removing a location", () => {
  const build = ({ locations = 2, used = { machines: 3, staff: 1, expenses: 0 }, exists = true } = {}) => {
    const destroy = vi.fn();
    const counts = { Equipment: used.machines, User: used.staff, Expense: used.expenses };
    const model = (name) => ({ count: async () => counts[name], update: vi.fn(async () => {}) });
    const models = {
      sequelize: { transaction: async (fn) => fn({ LOCK: { UPDATE: "UPDATE" } }) },
      Warehouse: { count: async () => locations, findByPk: async (id) => (exists && [1, 2].includes(Number(id)) ? { warehouse_id: id, destroy } : null) },
      Equipment: model("Equipment"),
      User: model("User"),
      Expense: model("Expense"),
    };
    return { models, destroy };
  };
  it("never removes the last one", async () => {
    const { models, destroy } = build({ locations: 1 });
    await expect(deleteWarehouse(models, 1, { moveToId: 2 })).rejects.toThrow(/at least one/);
    expect(destroy).not.toHaveBeenCalled();
  });
  it("won't remove one in use without somewhere to move things", async () => {
    const { models, destroy } = build();
    await expect(deleteWarehouse(models, 1)).rejects.toMatchObject({ statusCode: 409 });
    await expect(deleteWarehouse(models, 1, { moveToId: 1 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(deleteWarehouse(models, 1, { moveToId: 9 })).rejects.toMatchObject({ statusCode: 400 });
    expect(destroy).not.toHaveBeenCalled();
  });
  it("moves everything, then removes it", async () => {
    const { models, destroy } = build();
    expect(await deleteWarehouse(models, 1, { moveToId: 2 })).toEqual({ moved: { machines: 3, staff: 1, expenses: 0 } });
    for (const m of [models.Equipment, models.User, models.Expense]) {
      expect(m.update.mock.calls[0][0]).toEqual({ warehouse_id: 2 });
      expect(m.update.mock.calls[0][1].where).toEqual({ warehouse_id: 1 });
    }
    expect(destroy).toHaveBeenCalled();
  });
  it("an empty one just goes", async () => {
    const { models, destroy } = build({ used: { machines: 0, staff: 0, expenses: 0 } });
    await deleteWarehouse(models, 1);
    expect(destroy).toHaveBeenCalled();
    expect(models.Equipment.update).not.toHaveBeenCalled();
  });
});
