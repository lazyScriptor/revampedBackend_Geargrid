import { describe, it, expect, vi, beforeEach } from "vitest";
import { Op } from "sequelize";

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));

const { translateNamesToSinhala } = await import("../../src/services/equipmentTranslateService.js");
const { convertEquipmentNamesToSinhala, getAllEquipment } = await import("../../src/services/equipmentService.js");

describe("equipment Sinhala names", () => {
  beforeEach(() => {
    create.mockReset();
    process.env.ANTHROPIC_API_KEY = "test";
  });

  it("refuses with a clear 503 when no API key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(translateNamesToSinhala([{ id: 1, name: "Drill" }])).rejects.toMatchObject({ statusCode: 503 });
  });

  it("maps translated names back to ids and ignores bad batches", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: '{"1":"ඩ්‍රිල්","2":"  "}' }] });
    const out = await translateNamesToSinhala([{ id: 1, name: "Drill" }, { id: 2, name: "X" }]);
    expect(out.get(1)).toBe("ඩ්‍රිල්");
    expect(out.has(2)).toBe(false);
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "not json" }] });
    expect((await translateNamesToSinhala([{ id: 3, name: "Y" }])).size).toBe(0);
  });

  it("convert only fills missing Sinhala names unless overwrite is set", async () => {
    create.mockResolvedValue({ content: [{ type: "text", text: '{"5":"ජනක යන්ත්‍රය"}' }] });
    const update = vi.fn();
    const findAll = vi.fn().mockResolvedValue([{ equipment_id: 5, equipment_name: "Generator" }]);
    const models = { Equipment: { findAll, update } };
    const res = await convertEquipmentNamesToSinhala(models, {});
    expect(res).toEqual({ converted: 1, skipped: 0, total: 1 });
    expect(update).toHaveBeenCalledWith({ equipment_name_si: "ජනක යන්ත්‍රය" }, { where: { equipment_id: 5 } });
    expect(JSON.stringify(findAll.mock.calls[0][0].where[Op.and][0][Op.or])).toContain("equipment_name_si"); // only-missing filter
  });

  it("search matches the Sinhala name too", async () => {
    const findAndCountAll = vi.fn().mockResolvedValue({ count: 0, rows: [] });
    await getAllEquipment({ Equipment: { findAndCountAll }, EquipmentCategory: {}, Warehouse: {} }, { search: "ඩ්‍රිල්" });
    const or = findAndCountAll.mock.calls[0][0].where[Op.or];
    expect(JSON.stringify(or)).toContain("equipment_name_si");
  });
});
