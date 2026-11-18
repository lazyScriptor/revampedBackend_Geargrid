import { describe, it, expect, vi } from "vitest";
import { importEquipmentRows } from "../../src/services/equipmentNumberService.js";

let mockUserPermissions = [];
vi.mock("../../src/config/database.js", () => ({
  getCachedTenantConnection: () => ({}),
  masterSequelize: {},
  getTenantConnection: vi.fn(),
}));
vi.mock("../../src/models/index.js", () => ({
  initTenantModels: () => ({
    User: {
      findByPk: vi.fn(async () => ({
        user_id: 7,
        Roles: [{ role_id: 2, role_name: "Staff", hierarchy_level: 10, Permissions: mockUserPermissions.map((code, i) => ({ permission_id: i + 1, permission_code: code })) }],
      })),
    },
    UserPermissionOverride: { findAll: vi.fn(async () => []) },
    Role: {},
    Permission: {},
  }),
}));

const { importEquipmentSave } = await import("../../src/controllers/equipmentController.js");

const buildModels = ({ categories = [{ category_id: 1, category_name: "Power Tools" }], machines = [], warehouses = [{ warehouse_id: 9 }] } = {}) => {
  const state = {
    cats: categories.map((c) => ({ ...c })),
    machines: machines.map((m, i) => ({
      equipment_id: m.equipment_id ?? i + 1,
      category_id: 1,
      warehouse_id: 9,
      rented_qty: 0,
      defective_qty: 0,
      total_owned_qty: 1,
      base_rental_price: "500.00",
      extra_daily_rate: "400.00",
      minimum_rental_days: 1,
      is_bulk_item: false,
      ...m,
    })),
    jobs: [],
  };

  let nextCatId = 100;
  let nextEqId = 200;

  const models = {
    sequelize: {
      // Simulate real rollback semantics on an array snapshot when the callback throws.
      transaction: async (fn) => {
        const snapCats = state.cats.map((c) => ({ ...c }));
        const snapMachines = state.machines.map((m) => ({ ...m }));
        const snapJobs = state.jobs.map((j) => ({ ...j }));
        try {
          return await fn({ LOCK: { UPDATE: "UPDATE" } });
        } catch (err) {
          state.cats = snapCats;
          state.machines = snapMachines;
          state.jobs = snapJobs;
          throw err;
        }
      },
    },
    EquipmentCategory: {
      findAll: vi.fn(async () => state.cats.map((c) => ({ ...c }))),
      create: vi.fn(async (v) => {
        const row = { category_id: nextCatId++, ...v };
        state.cats.push(row);
        return row;
      }),
    },
    Warehouse: {
      findAll: vi.fn(async () => warehouses),
    },
    Equipment: {
      findAll: vi.fn(async ({ where } = {}) => {
        const list = state.machines.map((m) => ({
          ...m,
          toJSON: () => ({ ...m }),
          update: vi.fn(async (p) => {
            Object.assign(m, p);
            return m;
          }),
        }));
        if (where?.equipment_id) return list;
        return list;
      }),
      create: vi.fn(async (v) => {
        const row = { equipment_id: nextEqId++, ...v };
        state.machines.push(row);
        return row;
      }),
    },
    BulkJob: {
      create: vi.fn(async (v) => {
        const row = { job_id: state.jobs.length + 1, ...v };
        state.jobs.push(row);
        return row;
      }),
    },
  };

  return { models, state };
};

describe("equipmentNumberService.importEquipmentRows", () => {
  it("validates payload shapes, newcat refs, and 2000-row cap with 400", async () => {
    const { models } = buildModels();

    await expect(importEquipmentRows(models, { creates: "bad" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(importEquipmentRows(models, { creates: [], updates: [] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      importEquipmentRows(models, {
        newCategories: [{ ref: "badref", name: "Scaffolding" }],
        creates: [{ key: "r1", values: { equipment_name: "A", category_id: 1, base_rental_price: 100 } }],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      importEquipmentRows(models, {
        newCategories: [{ ref: "newcat:1", name: "X" }],
        creates: [{ key: "r1", values: { equipment_name: "A", category_id: 1, base_rental_price: 100 } }],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const tooMany = Array.from({ length: 2001 }, (_, i) => ({
      key: `r${i}`,
      values: { equipment_name: `Item ${i}`, category_id: 1, base_rental_price: 100 },
    }));
    await expect(importEquipmentRows(models, { creates: tooMany })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("creates new categories, reuses existing case-insensitively, replaces newcat refs, and writes BulkJob history", async () => {
    const { models, state } = buildModels({
      categories: [{ category_id: 1, category_name: "Power Tools" }],
      machines: [{ serial_number: "EQ-005", equipment_name: "Drill - 1" }],
    });

    const res = await importEquipmentRows(
      models,
      {
        newCategories: [
          { ref: "newcat:1", name: "Scaffolding" },
          { ref: "newcat:2", name: "  power tools  " },
        ],
        creates: [
          { key: "r1", values: { equipment_name: "Hilti Frame", category_id: "newcat:1", warehouse_id: 9, base_rental_price: 800, total_owned_qty: 10 } },
          { key: "r2", values: { equipment_name: "Makita Grinder", category_id: "newcat:2", warehouse_id: 9, base_rental_price: 500 } },
        ],
      },
      { userId: 7 },
    );

    expect(res.saved).toBe(true);
    expect(res.categoriesCreated).toEqual([
      { ref: "newcat:1", category_id: 100, name: "Scaffolding" },
      { ref: "newcat:2", category_id: 1, name: "Power Tools" },
    ]);
    // Only Scaffolding was created; power tools reused category_id 1
    expect(models.EquipmentCategory.create).toHaveBeenCalledTimes(1);
    expect(models.EquipmentCategory.create).toHaveBeenCalledWith(
      { category_name: "Scaffolding", description: "Added by import" },
      expect.anything(),
    );

    expect(res.created).toEqual([
      { key: "r1", equipment_id: 200, serial_number: "EQ-006" },
      { key: "r2", equipment_id: 201, serial_number: "EQ-007" },
    ]);
    expect(state.machines.find((m) => m.equipment_id === 200)).toMatchObject({
      category_id: 100,
      is_bulk_item: true,
      total_owned_qty: 10,
      available_qty: 10,
    });
    expect(state.machines.find((m) => m.equipment_id === 201).category_id).toBe(1);
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0]).toMatchObject({
      user_id: 7,
      operation: "import_equipment",
      entity: "equipment",
      mode: "import",
      status: "completed",
      total_count: 2,
      processed_count: 2,
      error_count: 0,
      input_file_path: null,
    });
  });

  it("rolls back everything including created categories when any row fails", async () => {
    const { models, state } = buildModels({
      categories: [{ category_id: 1, category_name: "Power Tools" }],
    });

    const res = await importEquipmentRows(models, {
      newCategories: [{ ref: "newcat:1", name: "Generators" }],
      creates: [
        { key: "r1", values: { equipment_name: "Gen 5kVA", category_id: "newcat:1", warehouse_id: 9, base_rental_price: 2500 } },
        { key: "r2", values: { equipment_name: "", category_id: "newcat:99", warehouse_id: 999, base_rental_price: "" } },
      ],
    });

    expect(res.saved).toBe(false);
    expect(res.errors).toEqual(
      expect.arrayContaining([
        { key: "r2", field: "category_id", code: "category_required" },
        { key: "r2", field: "warehouse_id", code: "warehouse_required" },
        { key: "r2", field: "base_rental_price", code: "price_required" },
        { key: "r2", field: "equipment_name", code: "name_required" },
      ]),
    );
    // Rolled back: Generators category and r1 machine were NOT persisted!
    expect(state.cats).toEqual([{ category_id: 1, category_name: "Power Tools" }]);
    expect(state.machines).toHaveLength(0);
    expect(state.jobs).toHaveLength(0);
  });

  it("supports updating existing machines and rejects lowering qty below rented+defective", async () => {
    const { models, state } = buildModels({
      machines: [
        { equipment_id: 10, serial_number: "EQ-010", equipment_name: "Mixer - 1", rented_qty: 3, total_owned_qty: 5, is_bulk_item: true },
      ],
    });

    const bad = await importEquipmentRows(models, {
      updates: [{ key: "r1", equipment_id: 10, changes: { total_owned_qty: 2 } }],
    });
    expect(bad).toEqual({
      saved: false,
      errors: [{ key: "r1", field: "total_owned_qty", code: "qty_below_out" }],
    });

    const ok = await importEquipmentRows(models, {
      updates: [{ key: "r1", equipment_id: 10, changes: { base_rental_price: "1800", total_owned_qty: 6 } }],
    });
    expect(ok).toEqual({ saved: true, created: [], updated: 1, categoriesCreated: [] });
    expect(state.machines[0]).toMatchObject({ base_rental_price: 1800, total_owned_qty: 6, available_qty: 3 });
  });
});

describe("importEquipmentRows: new category on an updated machine", () => {
  it("resolves newcat refs in updates as well as creates", async () => {
    const { models, state } = buildModels({
      machines: [{ equipment_id: 10, serial_number: "EQ-010", equipment_name: "Mixer - 1" }],
    });
    const res = await importEquipmentRows(models, {
      newCategories: [{ ref: "newcat:1", name: "Mixers" }],
      updates: [{ key: "r1", equipment_id: 10, changes: { category_id: "newcat:1" } }],
    });
    expect(res).toMatchObject({ saved: true, updated: 1 });
    const created = state.cats.find((c) => c.category_name === "Mixers");
    expect(created).toBeTruthy();
    expect(state.machines[0].category_id).toBe(created.category_id);
  });
});

describe("equipmentController.importEquipmentSave permission check", () => {
  it("returns 403 when newCategories is non-empty and the user lacks category:create", async () => {
    mockUserPermissions = ["equipment:action:bulk_import"];
    const req = {
      user: { userId: 7, tenantDbName: "geargrid_test" },
      body: {
        newCategories: [{ ref: "newcat:1", name: "Scaffolding" }],
        creates: [{ key: "r1", values: { equipment_name: "Frame", category_id: "newcat:1", base_rental_price: 100 } }],
      },
    };
    const res = { status: vi.fn(() => res), json: vi.fn() };
    const next = vi.fn();

    importEquipmentSave(req, res, next);

    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    const err = next.mock.calls[0][0];
    expect(err).toMatchObject({ statusCode: 403 });
    expect(err.message).toMatch(/category:create/);
  });
});
