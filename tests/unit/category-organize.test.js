import { describe, it, expect } from "vitest";
import { buildPlan, splitName } from "../../src/services/categoryOrganizeService.js";

const m = (name, i) => ({ equipment_id: i, equipment_name: name, category_id: 1 });
const plan = (names) => buildPlan(names.map(m));
const find = (p, f) => p.find((x) => x.name === f);

describe("category organize", () => {
  it("splits family and type from the name", () => {
    expect(splitName("Grinder ( 4 1/2 inch ) -3")).toEqual({ family: "Grinder", type: "4.5 inch" });
    expect(splitName("Spray gun -1  ( with compressor )")).toEqual({ family: "Spray gun", type: "with compressor" });
    expect(splitName("Miter Saw - big 1")).toEqual({ family: "Miter Saw", type: "big" });
    expect(splitName("Blower - 1")).toEqual({ family: "Blower", type: "" });
  });

  it("groups grinders by size", () => {
    const p = plan(["Grinder ( 4 inch ) -4", "Grinder ( 4 inch ) -6", "Grinder ( 7 inch ) -1", "Grinder ( 4 1/2 inch ) -1"]);
    const g = find(p, "Grinder");
    expect(g.types.map((t) => [t.name, t.machines.length])).toEqual([["4 inch", 2], ["4.5 inch", 1], ["7 inch", 1]]);
  });

  it("folds Battery Drill and Drill (with hammer) into Drill", () => {
    const p = plan(["Drill - 1", "Battery Drill - 1", "Bench Drill - 1", "Drill ( with hammer ) - 1"]);
    expect(p).toHaveLength(1);
    expect(p[0].name).toBe("Drill");
    expect(p[0].types.map((t) => t.name).sort()).toEqual(["Battery", "Bench", "Standard", "With hammer"]);
  });

  it("keeps a family with no types as plain machines", () => {
    const p = plan(["Blower - 1", "Blower - 2"]);
    expect(p[0].types).toHaveLength(0);
    expect(p[0].direct).toHaveLength(2);
  });
});
