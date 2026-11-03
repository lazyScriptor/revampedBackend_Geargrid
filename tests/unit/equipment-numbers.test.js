import { describe, it, expect, vi } from "vitest";
import { nextSerialValue, formatSerial, stripNameNumber, nextNameNumber, getNextEquipment, bulkSaveEquipment } from "../../src/services/equipmentNumberService.js";

const build = (machines = []) => {
  const list = machines.map((m, i) => ({ equipment_id: i + 1, rented_qty: 0, defective_qty: 0, ...m }));
  const created = [];
  return {
    created,
    models: {
      sequelize: { transaction: async (fn) => fn({ LOCK: { UPDATE: "UPDATE" } }) },
      EquipmentCategory: {
        findByPk: async (id) => (Number(id) === 1 ? { category_name: "Drill with Hammer" } : null),
        findAll: async () => [{ category_id: 1, category_name: "Drill with Hammer" }],
      },
      Warehouse: { findAll: async () => [{ warehouse_id: 9 }] },
      Equipment: {
        findAll: vi.fn(async ({ where } = {}) => {
          if (where?.category_id) return [...list].filter((m) => m.category_id === Number(where.category_id)).reverse();
          if (where?.equipment_id) return list.map((m) => ({ ...m, update: vi.fn(async (p) => Object.assign(m, p)) }));
          return list;
        }),
        create: vi.fn(async (v) => {
          const r = { equipment_id: 100 + created.length, ...v };
          created.push(r);
          return r;
        }),
      },
    },
  };
};

describe("numbers", () => {
  it("next EQ number follows the highest, ignoring other formats", () => {
    expect(nextSerialValue(["EQ-110", "EQ-059", "ABC-999", null])).toBe(111);
    expect(formatSerial(7)).toBe("EQ-007");
  });
  it("name helpers", () => {
    expect(stripNameNumber("Drill with Hammer - 5")).toBe("Drill with Hammer");
    expect(stripNameNumber("Grinder ( 4 inch ) -9")).toBe("Grinder ( 4 inch )");
    expect(nextNameNumber(["A - 1", "A - 2"])).toBe(3);
    expect(nextNameNumber(["A - 9"])).toBe(10); // a gap is never refilled
    expect(nextNameNumber(["Drill", "Other"])).toBe(3);
  });
  it("suggests name, Sinhala and usual price from the same type", async () => {
    const { models } = build([{ category_id: 1, serial_number: "EQ-110", equipment_name: "Drill with Hammer - 5", equipment_name_si: "හැමර් - 5", base_rental_price: "500.00", extra_daily_rate: "500.00", minimum_rental_days: 1, warehouse_id: 9 }]);
    const next = await getNextEquipment(models, { categoryId: 1 });
    expect(next).toMatchObject({ serial_number: "EQ-111", name_number: 6, base_name: "Drill with Hammer", base_name_si: "හැමර්", base_rental_price: 500, warehouse_id: 9 });
  });
  it("never reuses Sinhala from a differently named machine", async () => {
    const { models } = build([{ category_id: 1, serial_number: "EQ-1", equipment_name: "Other Tool - 1", equipment_name_si: "වෙනත්" }]);
    expect((await getNextEquipment(models, { categoryId: 1 })).base_name_si).toBe("");
  });
});

describe("bulk save", () => {
  const row = (over = {}) => ({ category_id: 1, base_rental_price: 500, ...over });

  it("fills blank numbers and names in order", async () => {
    const { models, created } = build([{ category_id: 1, serial_number: "EQ-110", equipment_name: "Drill with Hammer - 5" }]);
    const res = await bulkSaveEquipment(models, [row(), row()]);
    expect(res.saved).toBe(true);
    expect(created.map((c) => [c.serial_number, c.equipment_name])).toEqual([
      ["EQ-111", "Drill with Hammer - 6"],
      ["EQ-112", "Drill with Hammer - 7"],
    ]);
    expect(created[0]).toMatchObject({ warehouse_id: 9, extra_daily_rate: 500, available_qty: 1 });
  });
  it("a quantity row has no number in its name", async () => {
    const { models, created } = build();
    await bulkSaveEquipment(models, [row({ total_owned_qty: 20 })]);
    expect(created[0]).toMatchObject({ equipment_name: "Drill with Hammer", is_bulk_item: true, total_owned_qty: 20, available_qty: 20 });
  });
  it("saves nothing and reports each problem", async () => {
    const { models, created } = build([{ category_id: 1, serial_number: "EQ-110", equipment_name: "X - 1" }]);
    const res = await bulkSaveEquipment(models, [row(), row({ serial_number: "eq-110" }), row({ base_rental_price: "", category_id: 2 })]);
    expect(res.saved).toBe(false);
    expect(res.errors).toEqual(
      expect.arrayContaining([
        { row: 1, field: "serial_number", code: "number_taken" },
        { row: 2, field: "category_id", code: "category_required" },
        { row: 2, field: "base_rental_price", code: "price_required" },
      ]),
    );
    expect(created).toHaveLength(0);
  });
  it("two rows cannot share a number", async () => {
    const { models } = build();
    const res = await bulkSaveEquipment(models, [row({ serial_number: "EQ-5" }), row({ serial_number: "EQ-5" })]);
    expect(res.errors).toEqual([{ row: 1, field: "serial_number", code: "number_taken" }]);
  });
  it("edits existing machines; quantity can't go below what is out", async () => {
    const { models } = build([{ category_id: 1, serial_number: "EQ-1", equipment_name: "Pipe", rented_qty: 5, is_bulk_item: true }]);
    const low = await bulkSaveEquipment(models, [row({ equipment_id: 1, serial_number: "EQ-1", equipment_name: "Pipe", total_owned_qty: 3 })]);
    expect(low.errors[0].code).toBe("qty_below_out");
    const ok = await bulkSaveEquipment(models, [row({ equipment_id: 1, serial_number: "EQ-1", equipment_name: "Pipe", total_owned_qty: 8, base_rental_price: 700 })]);
    expect(ok.saved).toBe(true);
  });
});
