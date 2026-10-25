import { describe, it, expect } from "vitest";
import { loadImageRules, matchEquipmentImageKey } from "../../src/utils/equipmentImageRules.js";

const rules = loadImageRules();
const key = (n) => matchEquipmentImageKey(n, rules);

describe("equipment name → image key", () => {
  it.each([
    ["Bosch Hammer Drill 800W", "hammer-drill"],
    ["Drill ( with hammer ) - 2", "hammer-drill"],
    ["Bosch Rotary Hammer SDS+ 36V", "rotary-hammer"],
    ["Hilti - 3", "rotary-hammer"],
    ["Hilti bit 12", "hilti-bit"],
    ["Battery Drill - 4", "battery-drill"],
    ["Bench Drill - 1", "bench-drill"],
    ["Drill - 3", "power-drill"],
    ["DeWalt Impact Driver 20V", "impact-driver"],
    ["Dongchen Grinder 100W", "angle-grinder"],
    ["Grinder ( 7 inch ) -2", "angle-grinder"],
    ["Electrik breaker - small 5", "demolition-breaker"],
    ["Makita Heavy Demolition Breaker", "demolition-breaker"],
    ["Plate Compactor Wacker WP1540", "plate-compactor"], // must NOT become a scaffold plate
    ["Plate ( 13 feet )", "scaffold-plank"],
    ["Standard Scaffolding Frame (6x4)", "scaffold-frame"],
    ["Steel Scaffolding Plank", "scaffold-plank"],
    ["Scaffolding ( 4 * 5 )", "scaffolding"],
    ["Jack pipe", "scaffold-jack"],
    ["T jack", "scaffold-jack"],
    ["clamp", "scaffold-clamp"],
    ["Wheel", "scaffold-wheel"],
    ["Wheel Barrow - 3", "wheelbarrow"],
    ["G.I ( 20 feet )", "gi-pipe"],
    ["G.I Pipes", "gi-pipe"],
    ["Honda 10kVA Portable Generator", "generator"],
    ["Yamaha 3kVA Inverter Generator", "generator"],
    ["Caterpillar Mini Excavator 301.5", "excavator"],
    ["Aluminum Extension Ladder 20ft", "extension-ladder"],
    ["Aluminium Trestle Ladder 8ft", "trestle-ladder"],
    ["Straight Ladder ( 7 feet ) -2", "straight-ladder"],
    ["Step Ladder ( 12 feet ) - 1", "step-ladder"],
    ["Putty Mixer - 2", "putty-mixer"],
    ["Portable Concrete Mixer 140L", "concrete-mixer"],
    ["Concrete Mixer - 2", "concrete-mixer"],
    ["Compressor ( 1 piston ) - 9", "air-compressor"],
    ["Atlas Copco 185CFM Compressor", "air-compressor"],
    ["Spray gun -3  ( with compressor )", "spray-gun"], // not an air compressor
    ["Poker - 2  ( Comcrete vibrator )", "concrete-vibrator"],
    ["Poker Vibrator 35mm", "concrete-vibrator"],
    ["Concrete Cutter 14\"", "concrete-cutter"],
    ["Lincoln MIG Welder 350A", "mig-welder"],
    ["Welding Plant ( inverter ) -1", "welding-machine"],
    ["Arc Welder 250A", "welding-machine"],
    ["Plasma Cutter 50A", "plasma-cutter"],
    ["Safety Helmets Class A", "safety-helmet"],
    ["Full Body Safety Harness", "safety-harness"],
    ["Traffic Cones (Set of 10)", "traffic-cone"],
    ["Safety Barrier Board", "safety-barrier"],
    ["Chain Hoist 3T Electric", "chain-hoist"],
    ["Hoister - 1", "chain-hoist"],
    ["Chain block - 1", "chain-block"],
    ["Walk-Behind Roller 700kg", "road-roller"],
    ["Mobile Tower 1.4m (Aluminium)", "mobile-tower"],
    ["Water Moter - 2", "water-pump"],
    ["Submersible Pump 3\"", "water-pump"],
    ["Sewer Inspection Camera 30m", "inspection-camera"],
    ["Pipe Threading Machine 1/2\"-2\"", "pipe-threader"],
    ["Honda Lawnmower HRG466", "lawn-mower"],
    ["Grass Cutter - 1", "grass-cutter"],
    ["Husqvarna Chainsaw 445", "chainsaw"],
    ["Rotary Tiller 5.5HP", "tiller"],
    ["Hedge Trimmer Set (Electric)", "hedge-trimmer"],
    ["Makita Circular Saw 7.25\"", "circular-saw"],
    ["Circular Saw - 1", "circular-saw"],
    ["Miter Saw - aluminum wheel", "miter-saw"],
    ["Jig Saw - 3", "jig-saw"],
    ["Floor polisher - 1", "floor-polisher"],
    ["Blower - 1", "blower"],
    ["Vaccum Cleaner - 2", "vacuum-cleaner"],
    ["Bar Cutter - 1", "bar-cutter"],
    ["Tile Cutter ( 3 feet ) - 1", "tile-cutter"],
    ["Big Hammer - 2", "sledgehammer"],
    ["Showel - 3", "shovel"],
    ["Router - small ( trimmer )", "router"],
    ["Wire code ( 100 feet )", "extension-cord"],
    ["Heat gun - 1", "heat-gun"],
    ["Sander -4", "sander"],
  ])("%s → %s", (name, expected) => expect(key(name)).toBe(expected));

  it("explicitly skipped / unknown items get no image", () => {
    for (const n of ["Narassanaya - 2", "Pin ( additional )", "Concrete Columns ( 4 feet )  ( 9 in * 9 in )", "Putty cut machine", "Something unknown", "", null]) {
      expect(key(n)).toBeNull();
    }
  });

  it("every rule has a unique key and valid terms", () => {
    const keys = rules.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of rules) if (!r.skip) expect(r.terms.length).toBeGreaterThan(0);
  });
});
