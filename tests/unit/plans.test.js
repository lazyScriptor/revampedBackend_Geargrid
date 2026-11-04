import { describe, it, expect, vi, beforeEach } from "vitest";

const master = vi.hoisted(() => ({ config: null, tenant: null, upsert: vi.fn(), fail: false }));
vi.mock("../../src/models/master/index.js", () => ({
  getMasterModels: () => ({
    PlatformConfig: {
      findByPk: async () => {
        if (master.fail) throw new Error("master down");
        return master.config ? { config_value: master.config } : null;
      },
      upsert: async (row) => {
        master.upsert(row);
        master.config = row.config_value;
      },
    },
    Tenant: { findOne: async () => master.tenant },
  }),
}));
vi.mock("../../src/config/database.js", () => ({ getCachedTenantConnection: () => ({}), masterSequelize: {}, getTenantConnection: async () => ({}) }));
const usage = vi.hoisted(() => ({ machines: 0, users: 0, locations: 0 }));
vi.mock("../../src/models/index.js", () => ({
  initTenantModels: () => ({
    Equipment: { count: async () => usage.machines },
    User: { count: async () => usage.users },
    Warehouse: { count: async () => usage.locations },
  }),
}));

import { DEFAULT_PLANS, FEATURE_KEYS, effectivePlan, normalizeOverrides, normalizePlans } from "../../src/config/planCatalog.js";
import { capImportedMachines, clearPlanCache, getPlansForEditor, getTenantPlan, savePlans } from "../../src/services/planService.js";
import { enforceLimit, refuseDamagedWithoutMaintenance, requireFeature } from "../../src/middlewares/planMiddleware.js";

const run = async (mw, req) => {
  const next = vi.fn();
  await mw({ user: { tenantDbName: "shop" }, ...req }, {}, next);
  return next.mock.calls[0]?.[0];
};

beforeEach(() => {
  clearPlanCache();
  master.config = null;
  master.tenant = { tier: "Basic", feature_flags: {} };
  master.fail = false;
  master.upsert.mockClear();
  Object.assign(usage, { machines: 0, users: 0, locations: 0 });
});

describe("plan rules", () => {
  it("Basic starts small and leaves Accounting and Reports partly on; Enterprise has everything", () => {
    const { Basic, Enterprise } = DEFAULT_PLANS;
    expect(Basic.price).toBe(5900);
    expect(Basic.limits).toEqual({ max_equipment: 200, max_users: 3, max_locations: 1 });
    expect(Basic.features["accounting.invoices"]).toBe(true);
    expect(Basic.features["accounting.journal"]).toBe(false);
    expect(Basic.features.maintenance).toBe(false);
    expect(FEATURE_KEYS.every((k) => Enterprise.features[k])).toBe(true);
  });
  it("Workforce can't be on without Maintenance, in a plan or a shop exception", () => {
    const plans = normalizePlans({ Basic: { features: { workforce: true, maintenance: false } } });
    expect(plans.Basic.features.workforce).toBe(false);
    const shop = effectivePlan(normalizePlans({ Pro: {} }), "Pro", { features: { maintenance: false } });
    expect(shop.features.workforce).toBe(false);
  });
  it("cleans submitted plans: unknown keys go, bad limits fall back, blank means unlimited", () => {
    const plans = normalizePlans({ Basic: { price: "abc", features: { evil: true }, limits: { max_users: -4, max_equipment: "", max_locations: 2 } } });
    expect(plans.Basic.features.evil).toBeUndefined();
    expect(plans.Basic.price).toBe(5900);
    expect(plans.Basic.limits).toEqual({ max_users: 3, max_equipment: null, max_locations: 2 });
  });
  it("a shop's exceptions beat its tier, and only real keys count", () => {
    const plans = normalizePlans({});
    const shop = effectivePlan(plans, "Basic", { features: { maintenance: true, nope: true, messages: false }, limits: { max_users: 10, max_equipment: null, max_locations: "x" } });
    expect(shop.features).toMatchObject({ maintenance: true, messages: false });
    expect(shop.features.nope).toBeUndefined();
    expect(shop.limits).toEqual({ max_equipment: null, max_users: 10, max_locations: 1 });
    expect(normalizeOverrides(undefined)).toEqual({ features: {}, limits: {} });
  });
  it("an unknown tier gets Basic, never everything", () => {
    expect(effectivePlan(normalizePlans({}), "Gold", {}).tier).toBe("Basic");
  });
});

describe("saving plans", () => {
  const edited = () => {
    const plans = normalizePlans({});
    plans.Basic.features.maintenance = true;
    return plans;
  };
  it("saves, and shops see it on their next request", async () => {
    expect((await getTenantPlan("shop")).features.maintenance).toBe(false);
    const res = await savePlans({ plans: edited(), version: 0 });
    expect(res.version).toBe(1);
    expect((await getTenantPlan("shop")).features.maintenance).toBe(true);
  });
  it("a save from an out-of-date screen is refused", async () => {
    await savePlans({ plans: edited(), version: 0 });
    await expect(savePlans({ plans: edited(), version: 0 })).rejects.toMatchObject({ statusCode: 409 });
    expect(master.upsert).toHaveBeenCalledTimes(1);
  });
  it("features added after a save start at their default", async () => {
    master.config = { version: 3, plans: { Basic: { features: { maintenance: true } } } };
    const { plans, version } = await getPlansForEditor();
    expect(version).toBe(3);
    expect(plans.Basic.features.maintenance).toBe(true);
    expect(plans.Basic.features["accounting.invoices"]).toBe(true);
    expect(plans.Pro.features.maintenance).toBe(true);
  });
  it("reads JSON stored as text", async () => {
    master.config = JSON.stringify({ version: 2, plans: {} });
    expect((await getPlansForEditor()).version).toBe(2);
  });
});

describe("checks on requests", () => {
  it("blocks what the plan leaves out, admins included", async () => {
    expect((await run(requireFeature("maintenance"), {}))?.statusCode).toBe(403);
    expect(await run(requireFeature("accounting.invoices"), {})).toBeUndefined();
  });
  it("Enterprise passes everything", async () => {
    master.tenant = { tier: "Enterprise", feature_flags: "{}" };
    expect(await run(requireFeature("maintenance"), {})).toBeUndefined();
    usage.machines = 100000;
    expect(await run(enforceLimit("max_equipment"), {})).toBeUndefined();
  });
  it("if the plan can't be read the shop keeps working", async () => {
    master.fail = true;
    expect(await run(requireFeature("maintenance"), {})).toBeUndefined();
    master.fail = false;
    clearPlanCache();
    master.tenant = null;
    expect(await run(requireFeature("maintenance"), {})).toBeUndefined();
  });
  it("limits stop adding at the limit, never editing", async () => {
    usage.machines = 199;
    expect(await run(enforceLimit("max_equipment"), {})).toBeUndefined();
    usage.machines = 200;
    expect((await run(enforceLimit("max_equipment"), {}))?.statusCode).toBe(403);
    expect(await run(enforceLimit("max_equipment", () => 0), {})).toBeUndefined();
    expect(await run(enforceLimit("max_equipment", () => -1), {})).toBeUndefined();
  });
  it("a shop's own exception lifts a limit", async () => {
    master.tenant = { tier: "Basic", feature_flags: { plan_overrides: { limits: { max_users: 10 } } } };
    usage.users = 5;
    expect(await run(enforceLimit("max_users"), {})).toBeUndefined();
  });
  it("damaged returns need Maintenance; good returns never do", async () => {
    const damaged = { body: { lines_returned: [{ good_qty: 1, defective_qty: "1" }] } };
    expect((await run(refuseDamagedWithoutMaintenance, damaged))?.statusCode).toBe(403);
    expect(await run(refuseDamagedWithoutMaintenance, { body: { lines_returned: [{ good_qty: 2, defective_qty: 0 }] } })).toBeUndefined();
    master.tenant = { tier: "Pro", feature_flags: {} };
    clearPlanCache();
    expect(await run(refuseDamagedWithoutMaintenance, damaged)).toBeUndefined();
  });
});

describe("imports under the limit", () => {
  it("existing machines still update; new ones stop at the limit", async () => {
    usage.machines = 199;
    const models = {
      Equipment: { count: async () => 199, findAll: async () => [{ serial_number: "EQ-1" }] },
    };
    const { allowed, refused } = await capImportedMachines(models, "shop", [
      { serial_number: "eq-1", equipment_name: "old" },
      { serial_number: "EQ-2", equipment_name: "new one" },
      { serial_number: "EQ-3", equipment_name: "new two" },
    ]);
    expect(allowed.map((r) => r.equipment_name)).toEqual(["old", "new one"]);
    expect(refused.map((r) => r.equipment_name)).toEqual(["new two"]);
  });
});
