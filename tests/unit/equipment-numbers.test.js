import { describe, it, expect, vi } from "vitest";
import { nextSerialValue, formatSerial, parseName, renumberName, getNextEquipment, bulkSaveEquipment } from "../../src/services/equipmentNumberService.js";

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
    expect(nextSerialValue(["EQ-110", "EQ -120", "Eq-115"])).toBe(121);
    expect(formatSerial(7)).toBe("EQ-007");
  });
});

describe("machine names", () => {
  const next = (name, n) => renumberName(parseName(name), n);
  it.each([
    ["Battery Drill - 6", 7, "Battery Drill - 7"],
    ["Battery Drill-6", 7, "Battery Drill-7"],
    ["Battery Drill 6", 7, "Battery Drill 7"],
    ["Battery Drill #6", 7, "Battery Drill #7"],
    ["Battery Drill No. 6", 7, "Battery Drill No. 7"],
    ["Battery Drill (6)", 7, "Battery Drill (7)"],
    ["6 - Battery Drill", 7, "7 - Battery Drill"],
    ["6-Battery Drill", 7, "7-Battery Drill"],
    ["No 6 Battery Drill", 7, "No 7 Battery Drill"],
    ["Battery Drill - 06", 7, "Battery Drill - 07"],
    ["Battery Drill - 09", 10, "Battery Drill - 10"],
    ["Drill - 6 (Bosch)", 7, "Drill - 7 (Bosch)"],
    ["Grinder ( 4 inch ) - 9", 10, "Grinder ( 4 inch ) - 10"],
    ["10-Inch Grinder - 3", 4, "10-Inch Grinder - 4"],
    ["බැටරි ඩ්‍රිල් - 6", 7, "බැටරි ඩ්‍රිල් - 7"],
    ["Sander -1", 7, "Sander -7"],
    ["Hilti bit 15", 16, "Hilti bit 16"],
    ["Electrik breaker - big 4", 5, "Electrik breaker - big 5"],
    ["Poker - 2  ( Comcrete vibrator )", 3, "Poker - 3  ( Comcrete vibrator )"],
    ["Spray gun -6  ( with compressor )", 7, "Spray gun -7  ( with compressor )"],
    ["Grinder ( 4 1/2 inch ) -9", 10, "Grinder ( 4 1/2 inch ) -10"],
    ["Step Ladder ( 10 feet ) - 2", 3, "Step Ladder ( 10 feet ) - 3"],
  ])("%s becomes the next in the same format", (name, n, want) => {
    expect(next(name, n)).toBe(want);
  });
  it.each(["Grinder 4 inch", "Grinder ( 4 inch )", "Bit 1/2", "Cable 2.5", "Bolt M10", "12V Drill", "2 Ton Jack", "Scaffold 3x3", "Husqvarna Chainsaw 445", "Caterpillar Mini Excavator 301.5", "Honda Lawnmower HRG466", "Concrete Cutter 14\"", "Traffic Cones (Set of 10)", "Scaffolding ( 3 * 5 )", "Concrete Columns ( 4 feet )  ( 9 in * 9 in )"])("%s has no number", (name) => {
    expect(parseName(name).number).toBeNull();
  });
  it("every way of writing the number has the same text", () => {
    const key = parseName("Battery Drill - 6").key;
    for (const n of ["battery drill-9", "BATTERY DRILL 2", "Battery  Drill #3", "Battery Drill No. 4", "Battery Drill (5)", "7 - Battery Drill", "Battery Drill"]) {
      expect(parseName(n).key).toBe(key);
    }
    expect(parseName("Battery Drill 18V - 2").key).not.toBe(key);
    expect(parseName("Drill - 1").key).not.toBe(key);
  });
});

describe("next machine like a picked one", () => {
  const m = (equipment_name, equipment_name_si, over = {}) => ({ category_id: 3, warehouse_id: 9, base_rental_price: "500.00", extra_daily_rate: "400.00", minimum_rental_days: 2, serial_number: "EQ-1", equipment_name, equipment_name_si, ...over });

  it("uses the highest number of the exact text, not the picked one or the category", async () => {
    const { models } = build([
      m("Battery Drill - 6", "බැටරි - 6", { serial_number: "EQ-110" }),
      m("Battery Drill - 12", null),
      m("Battery Drill 18V - 40", null),
      m("Hammer - 90", null),
    ]);
    const next = await getNextEquipment(models, { likeId: 1 });
    expect(next).toMatchObject({ serial_number: "EQ-111", name_number: 13, equipment_name: "Battery Drill - 13", equipment_name_si: "බැටරි - 13", category_id: 3, warehouse_id: 9, base_rental_price: 500, extra_daily_rate: 400, minimum_rental_days: 2 });
  });
  it("keeps the picked machine's format", async () => {
    const { models } = build([m("Pump - 3", null), m("07-Pump", null)]);
    expect((await getNextEquipment(models, { likeId: 2 })).equipment_name).toBe("08-Pump");
    expect((await getNextEquipment(models, { likeId: 1 })).equipment_name).toBe("Pump - 8");
  });
  it("a machine with no number is number 1, and takes the format of numbered ones", async () => {
    const { models } = build([m("Mixer", null)]);
    expect((await getNextEquipment(models, { likeId: 1 })).equipment_name).toBe("Mixer - 2");
    const two = build([m("Mixer", null), m("Mixer-5", null)]);
    expect((await getNextEquipment(two.models, { likeId: 1 })).equipment_name).toBe("Mixer-6");
  });
  it("Sinhala: blank when no machine has it, numbered when it has no number", async () => {
    const none = build([m("Saw - 1", null)]);
    expect((await getNextEquipment(none.models, { likeId: 1 })).equipment_name_si).toBe("");
    const plain = build([m("Saw - 1", "කියත")]);
    expect((await getNextEquipment(plain.models, { likeId: 1 })).equipment_name_si).toBe("කියත - 2");
    const other = build([m("Saw - 1", null), m("Saw - 2", "කියත - 2")]);
    expect((await getNextEquipment(other.models, { likeId: 1 })).equipment_name_si).toBe("කියත - 3");
    const wrong = build([m("Saw - 1", null), m("Hammer - 2", "මිටිය - 2")]);
    expect((await getNextEquipment(wrong.models, { likeId: 1 })).equipment_name_si).toBe("");
  });
  it("says when the picked machine is a quantity machine", async () => {
    const { models } = build([m("Scaffolding", null, { is_bulk_item: 1, total_owned_qty: 100 })]);
    expect(await getNextEquipment(models, { likeId: 1 })).toMatchObject({ is_bulk_item: true, total_owned_qty: 100, base_name: "Scaffolding" });
  });
  it("without a machine, only the EQ number", async () => {
    const { models } = build([m("Saw - 1", null, { serial_number: "EQ-050" })]);
    expect(await getNextEquipment(models)).toEqual({ serial_number: "EQ-051" });
    await expect(getNextEquipment(models, { likeId: 99 })).rejects.toThrow(/not found/i);
  });
});

describe("bulk save", () => {
  const row = (over = {}) => ({ category_id: 1, base_rental_price: 500, ...over });

  it("fills blank EQ numbers in order and keeps the names given", async () => {
    const { models, created } = build([{ category_id: 1, serial_number: "EQ-110", equipment_name: "Drill - 5" }]);
    const res = await bulkSaveEquipment(models, [row({ equipment_name: "Drill - 6" }), row({ equipment_name: "Drill - 7" })]);
    expect(res.saved).toBe(true);
    expect(created.map((c) => [c.serial_number, c.equipment_name])).toEqual([
      ["EQ-111", "Drill - 6"],
      ["EQ-112", "Drill - 7"],
    ]);
    expect(created[0]).toMatchObject({ warehouse_id: 9, extra_daily_rate: 500, available_qty: 1 });
  });
  it("never makes a name up from the category", async () => {
    const { models, created } = build();
    const res = await bulkSaveEquipment(models, [row()]);
    expect(res.errors).toEqual([{ row: 0, field: "equipment_name", code: "name_required" }]);
    expect(created).toHaveLength(0);
  });
  it("a quantity row is one record", async () => {
    const { models, created } = build();
    await bulkSaveEquipment(models, [row({ equipment_name: "Pipe", total_owned_qty: 20 })]);
    expect(created[0]).toMatchObject({ equipment_name: "Pipe", is_bulk_item: true, total_owned_qty: 20, available_qty: 20 });
  });
  it("saves nothing and reports each problem", async () => {
    const { models, created } = build([{ category_id: 1, serial_number: "EQ-110", equipment_name: "X - 1" }]);
    const res = await bulkSaveEquipment(models, [row({ equipment_name: "A - 1" }), row({ equipment_name: "A - 2", serial_number: "eq-110" }), row({ equipment_name: "A - 3", base_rental_price: "", category_id: 2 })]);
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
    const res = await bulkSaveEquipment(models, [row({ equipment_name: "A - 1", serial_number: "EQ-5" }), row({ equipment_name: "A - 2", serial_number: "EQ-5" })]);
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
