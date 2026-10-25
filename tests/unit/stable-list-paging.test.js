import { describe, it, expect } from "vitest";
import { getAllEquipment } from "../../src/services/equipmentService.js";
import { getAllCustomers } from "../../src/services/customerService.js";

// A bulk import stamps every row with the same createdAt. MySQL is free to return tied rows
// in any order on each query, so `ORDER BY createdAt DESC LIMIT n OFFSET m` showed the same
// machines on several pages and never showed others. This fake table reproduces that: ties
// come back in a different (seeded) order on every call, and only an ORDER BY that fully
// determines the order — i.e. one with a unique tie-breaker — pages cleanly.
const makeTable = (idField, total) => {
  const rows = Array.from({ length: total }, (_, i) => ({
    [idField]: i + 1,
    createdAt: new Date("2026-03-01T10:00:00Z"), // identical for every row
  }));
  let call = 0;
  const query = ({ order = [], limit, offset = 0 }) => {
    call += 1;
    // a different arbitrary order of the tied rows on every call
    const shuffled = [...rows].sort((a, b) => ((a[idField] * 7919 + call * 104729) % 97) - ((b[idField] * 7919 + call * 104729) % 97));
    const sorted = shuffled.sort((a, b) => {
      for (const [field, dir] of order) {
        const av = a[field];
        const bv = b[field];
        if (av < bv) return dir === "DESC" ? 1 : -1;
        if (av > bv) return dir === "DESC" ? -1 : 1;
      }
      return 0;
    });
    return sorted.slice(offset, offset + limit);
  };
  return {
    findAndCountAll: async (opts) => ({ count: total, rows: query(opts) }),
    findAll: async (opts) => query(opts),
  };
};

const walk = async (fetchPage, idField, pages) => {
  const seen = [];
  for (let page = 1; page <= pages; page++) {
    const list = await fetchPage(page);
    seen.push(...list.map((r) => r[idField]));
  }
  return seen;
};

describe("OFFSET paging is stable when rows share a createdAt", () => {
  it("equipment: every machine appears exactly once across pages", async () => {
    const table = makeTable("equipment_id", 213);
    const models = { Equipment: table, EquipmentCategory: {}, Warehouse: {} };
    const ids = await walk(
      async (page) => (await getAllEquipment(models, { page, limit: 24 })).equipment,
      "equipment_id",
      Math.ceil(213 / 24),
    );
    expect(ids).toHaveLength(213);
    expect(new Set(ids).size).toBe(213);
  });

  it("customers (counted list): every customer appears exactly once across pages", async () => {
    const table = makeTable("customer_id", 95);
    const models = { Customer: table };
    const ids = await walk(
      async (page) => (await getAllCustomers(models, { page, limit: 20 })).customers,
      "customer_id",
      Math.ceil(95 / 20),
    );
    expect(new Set(ids).size).toBe(95);
  });

  it("customers (skip_count fast path) pages stably too", async () => {
    const table = makeTable("customer_id", 40);
    const models = { Customer: table };
    const ids = await walk(
      async (page) => (await getAllCustomers(models, { page, limit: 15, skip_count: "true" })).customers,
      "customer_id",
      3,
    );
    expect(new Set(ids).size).toBe(40);
  });

  it("the fake table really does reproduce the bug when no tie-breaker is given", async () => {
    const table = makeTable("equipment_id", 213);
    const ids = await walk(
      async (page) => table.findAndCountAll({ order: [["createdAt", "DESC"]], limit: 24, offset: (page - 1) * 24 }).then((r) => r.rows),
      "equipment_id",
      9,
    );
    expect(new Set(ids).size).toBeLessThan(213);
  });
});
