import { describe, it, expect, vi } from "vitest";
import { deleteEquipment, getAllEquipment } from "../../src/services/equipmentService.js";

const build = ({ lines = 0, defects = 0, rented = 0 } = {}) => {
  const machine = { equipment_name: "Drill", rented_qty: rented, update: vi.fn(), destroy: vi.fn() };
  return {
    machine,
    models: {
      Equipment: { findByPk: async () => machine, findAndCountAll: vi.fn(async () => ({ count: 0, rows: [] })) },
      EquipmentCategory: {},
      Warehouse: {},
      InvoiceLine: { count: async () => lines },
      DefectLog: { count: async () => defects },
      PhotoRequest: { destroy: vi.fn() },
    },
  };
};

describe("deleting a machine", () => {
  it("with invoice history: archived, never removed", async () => {
    const { models, machine } = build({ lines: 3 });
    expect(await deleteEquipment(models, 1)).toEqual({ archived: true });
    expect(machine.update.mock.calls[0][0].is_archived).toBe(true);
    expect(machine.destroy).not.toHaveBeenCalled();
  });
  it("with repair history: archived", async () => {
    const { models } = build({ defects: 1 });
    expect(await deleteEquipment(models, 1)).toEqual({ archived: true });
  });
  it("with no history: really deleted, photo requests first", async () => {
    const { models, machine } = build();
    expect(await deleteEquipment(models, 1)).toEqual({ archived: false });
    expect(models.PhotoRequest.destroy).toHaveBeenCalled();
    expect(machine.destroy).toHaveBeenCalled();
  });
  it("still out on rent: refused", async () => {
    const { models } = build({ rented: 2 });
    await expect(deleteEquipment(models, 1)).rejects.toThrow(/2 units/);
  });
  it("archived machines are left out of the list", async () => {
    const { models } = build();
    await getAllEquipment(models, {});
    expect(models.Equipment.findAndCountAll.mock.calls[0][0].where.is_archived).toBe(false);
  });
});
