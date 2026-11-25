import { describe, it, expect } from "vitest";
import { planDuplicateIndexDrops, dropDuplicateIndexes } from "../../migrations/lib/duplicateIndexes.js";
import * as tenantMigration from "../../migrations/tenant/20261125000100-drop-duplicate-sync-indexes.js";
import * as masterMigration from "../../migrations/master/20261125000100-drop-duplicate-sync-indexes.js";

// information_schema.STATISTICS rows for one index (one row per column).
const ix = (table, name, cols, { unique = true, type = "BTREE", sub = {} } = {}) =>
  cols.map((c, i) => ({
    table_name: table,
    index_name: name,
    non_unique: unique ? 0 : 1,
    seq: i + 1,
    column_name: c,
    sub_part: sub[c] ?? null,
    index_type: type,
  }));

const copies = (table, base, cols, from, to, opts) => {
  const rows = [];
  for (let n = from; n <= to; n++) rows.push(...ix(table, `${base}_${n}`, cols, opts));
  return rows;
};

// Fake queryInterface whose database is `rows`; removeIndex really removes them, so re-runs see the result.
const fakeQi = (initialRows, { failOn = {} } = {}) => {
  let rows = [...initialRows];
  const removed = [];
  return {
    removed,
    rows: () => rows,
    sequelize: {
      query: async (sql) => {
        if (!/information_schema\.STATISTICS/.test(sql)) throw new Error(`unexpected query: ${sql}`);
        return rows.map((r) => ({ ...r }));
      },
    },
    removeIndex: async (table, name) => {
      if (failOn[name]) throw failOn[name];
      removed.push(`${table}.${name}`);
      rows = rows.filter((r) => !(r.table_name === table && r.index_name === name));
    },
  };
};

const quiet = { log: () => {} };

describe("duplicate sync index cleanup", () => {
  it("drops numbered copies of the base index and keeps the base", () => {
    const rows = [
      ...ix("USERS", "PRIMARY", ["user_id"]),
      ...ix("USERS", "email", ["email"]),
      ...copies("USERS", "email", ["email"], 2, 21),
      ...ix("USERS", "username", ["username"]),
      ...copies("USERS", "username", ["username"], 2, 3),
    ];
    const plan = planDuplicateIndexDrops(rows);
    expect(plan).toHaveLength(22);
    expect(plan.map((d) => d.index)).not.toContain("email");
    expect(plan.map((d) => d.index)).not.toContain("username");
    expect(plan.map((d) => d.index)).not.toContain("PRIMARY");
    expect(plan.find((d) => d.index === "email_21")).toEqual({ table: "USERS", index: "email_21", keep: "email" });
    expect(plan.find((d) => d.index === "username_3").keep).toBe("username");
  });

  it("keeps the lowest-numbered copy when the base index itself is gone", () => {
    const plan = planDuplicateIndexDrops([...copies("T", "token", ["token"], 2, 5)]);
    expect(plan.map((d) => d.index)).toEqual(["token_3", "token_4", "token_5"]);
    expect(plan.every((d) => d.keep === "token_2")).toBe(true);
  });

  it("never drops an index whose columns, order, prefix, uniqueness or type differ", () => {
    const rows = [
      ...ix("T", "phone", ["phone"]),
      ...ix("T", "phone_2", ["phone", "tenant_id"]), // extra column
      ...ix("T", "pair", ["a", "b"]),
      ...ix("T", "pair_2", ["b", "a"]), // different order
      ...ix("T", "name", ["name"]),
      ...ix("T", "name_2", ["name"], { unique: false }), // not unique
      ...ix("T", "title", ["title"], { sub: { title: 100 } }),
      ...ix("T", "title_2", ["title"], { sub: { title: 50 } }), // different prefix length
      ...ix("T", "body", ["body"], { unique: false, type: "BTREE" }),
      ...ix("T", "body_2", ["body"], { unique: false, type: "FULLTEXT" }), // different type
    ];
    expect(planDuplicateIndexDrops(rows)).toEqual([]);
  });

  it("ignores identical indexes that are not numbered copies of each other", () => {
    const rows = [
      ...ix("RETAIL_BRANDS", "name", ["name"]),
      ...ix("RETAIL_BRANDS", "uq_retail_brands_name", ["name"]),
      ...ix("T", "address_line_2", ["address_line_2"]), // numbered-looking name, no sibling
      ...ix("T", "code_2", ["code"]),
      ...ix("T", "other", ["code"]), // same columns but not the `code` family
    ];
    expect(planDuplicateIndexDrops(rows)).toEqual([]);
  });

  it("treats tables separately", () => {
    const rows = [...ix("A", "email", ["email"]), ...ix("B", "email_2", ["email"])];
    expect(planDuplicateIndexDrops(rows)).toEqual([]);
  });

  it("drops through the queryInterface and finds nothing on a second run", async () => {
    const qi = fakeQi([
      ...ix("CUSTOMERS", "PRIMARY", ["customer_id"]),
      ...ix("CUSTOMERS", "nic_number", ["nic_number"]),
      ...copies("CUSTOMERS", "nic_number", ["nic_number"], 2, 20),
      ...ix("CUSTOMERS", "parent_customer_id", ["parent_customer_id"], { unique: false }),
    ]);
    const first = await dropDuplicateIndexes(qi, quiet);
    expect(first.dropped).toHaveLength(19);
    expect(qi.removed).toContain("CUSTOMERS.nic_number_20");
    expect(qi.removed).not.toContain("CUSTOMERS.nic_number");
    expect(new Set(qi.rows().map((r) => r.index_name))).toEqual(new Set(["PRIMARY", "nic_number", "parent_customer_id"]));

    const second = await dropDuplicateIndexes(qi, quiet);
    expect(second.dropped).toEqual([]);
    expect(qi.removed).toHaveLength(19);
  });

  it("skips an index a foreign key still needs, and rethrows any other error", async () => {
    const fkErr = Object.assign(new Error("needed in a foreign key constraint"), { original: { errno: 1553 } });
    const qi = fakeQi([...ix("T", "user_id", ["user_id"], { unique: false }), ...copies("T", "user_id", ["user_id"], 2, 3, { unique: false })], {
      failOn: { user_id_2: fkErr },
    });
    const res = await dropDuplicateIndexes(qi, quiet);
    expect(res.dropped.map((d) => d.index)).toEqual(["user_id_3"]);
    expect(res.skipped.map((d) => d.index)).toEqual(["user_id_2"]);

    const boom = fakeQi([...ix("T", "a", ["a"]), ...ix("T", "a_2", ["a"])], { failOn: { a_2: new Error("lock wait timeout") } });
    await expect(dropDuplicateIndexes(boom, quiet)).rejects.toThrow("lock wait timeout");
  });

  it("tenant and master migrations run the cleanup and are idempotent", async () => {
    for (const mig of [tenantMigration, masterMigration]) {
      const qi = fakeQi([...ix("TENANTS", "slug", ["slug"]), ...copies("TENANTS", "slug", ["slug"], 2, 4)]);
      await mig.up({ context: qi });
      await mig.up({ context: qi });
      expect(qi.removed).toEqual(["TENANTS.slug_2", "TENANTS.slug_3", "TENANTS.slug_4"]);
      await expect(mig.down()).resolves.toBeUndefined();
    }
  });
});
