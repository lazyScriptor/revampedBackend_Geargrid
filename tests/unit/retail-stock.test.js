import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Op } from "sequelize";
import {
  createReceiveDocument,
  updateReceiveDraft,
  postReceiveDocument,
  postAdjustDocument,
  postCountDocument,
  postOpeningDocument,
  getStockLevelsDelta,
  checkStockIntegrity,
  stripCostFields,
  addCents,
  toCents,
} from "../../src/modules/retail/index.js";

const makeRecord = (data, pkField) => {
  const rec = { ...data };
  rec.update = vi.fn(async (patch) => {
    Object.assign(rec, patch);
    return rec;
  });
  rec.destroy = vi.fn(async () => {
    rec._destroyed = true;
  });
  rec.get = () => rec.toJSON();
  rec.toJSON = () => {
    const out = {};
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v !== "function" && !k.startsWith("_")) out[k] = v;
    }
    return out;
  };
  if (pkField && rec[pkField] === undefined) rec[pkField] = 1;
  return rec;
};

const makeStockHarness = ({
  products = [],
  warehouses = [{ warehouse_id: 1, name: "Main", is_default: true }],
  retailSettings = {},
  levels = [],
} = {}) => {
  const prodRecords = products.map((p) => makeRecord({ avg_cost: 0, last_cost: null, Units: [], ...p }, "product_id"));
  const levelRecords = levels.map((l) => makeRecord({ qty_on_hand: 0, counted_at: null, updatedAt: new Date(), ...l }));
  const docs = [];
  const docLines = [];
  const movements = [];
  const serials = [];

  const models = {
    TenantConfig: {
      findOne: vi.fn(async () => ({ custom_settings: { retail: retailSettings } })),
    },
    Warehouse: {
      findByPk: vi.fn(async (id) => warehouses.find((w) => w.warehouse_id === Number(id)) || null),
      findOne: vi.fn(async () => warehouses[0] || null),
    },
    User: {
      findByPk: vi.fn(async (id) => ({
        user_id: id,
        first_name: "Test",
        last_name: "User",
        Roles: [{ role_id: 1, role_name: "Cashier", hierarchy_level: 10, Permissions: [] }],
      })),
    },
    UserPermissionOverride: { findAll: vi.fn(async () => []) },
    RetailProduct: {
      findAll: vi.fn(async ({ where }) => {
        if (where?.product_id?.[Op.in]) {
          return prodRecords.filter((p) => where.product_id[Op.in].includes(p.product_id));
        }
        return prodRecords;
      }),
      findByPk: vi.fn(async (id) => prodRecords.find((p) => p.product_id === Number(id)) || null),
    },
    RetailStockLevel: {
      findOne: vi.fn(async ({ where }) =>
        levelRecords.find(
          (l) => l.product_id === Number(where.product_id) && l.warehouse_id === Number(where.warehouse_id),
        ) || null,
      ),
      findAll: vi.fn(async ({ where } = {}) => {
        return levelRecords.filter((l) => {
          if (where?.product_id?.[Op.in] && !where.product_id[Op.in].includes(l.product_id)) return false;
          if (where?.warehouse_id && l.warehouse_id !== Number(where.warehouse_id)) return false;
          if (where?.updatedAt?.[Op.gt] && !(new Date(l.updatedAt) > where.updatedAt[Op.gt])) return false;
          return true;
        });
      }),
      create: vi.fn(async (d) => {
        const rec = makeRecord({ updatedAt: new Date(), ...d });
        levelRecords.push(rec);
        return rec;
      }),
      update: vi.fn(async (patch, { where }) => {
        const rec = levelRecords.find(
          (l) => l.product_id === Number(where.product_id) && l.warehouse_id === Number(where.warehouse_id),
        );
        if (!rec) return [0];
        Object.assign(rec, patch);
        return [1];
      }),
    },
    RetailStockDocument: {
      findAll: vi.fn(async ({ where }) =>
        docs.filter((d) => (!where?.doc_type || d.doc_type === where.doc_type)),
      ),
      findByPk: vi.fn(async (id) => {
        const d = docs.find((x) => x.doc_id === Number(id));
        if (!d) return null;
        d.Lines = docLines.filter((l) => l.doc_id === d.doc_id);
        return d;
      }),
      create: vi.fn(async (d) => {
        const rec = makeRecord({ doc_id: docs.length + 1, ...d }, "doc_id");
        docs.push(rec);
        return rec;
      }),
      update: vi.fn(async (patch, { where }) => {
        const d = docs.find((x) => x.doc_id === Number(where.doc_id));
        if (!d) return [0];
        if (where.status && d.status !== where.status) return [0];
        if (where.version !== undefined && Number(d.version) !== Number(where.version)) return [0];
        Object.assign(d, patch);
        return [1];
      }),
    },
    RetailStockDocumentLine: {
      findAll: vi.fn(async ({ where }) => docLines.filter((l) => l.doc_id === Number(where.doc_id))),
      create: vi.fn(async (d) => {
        const rec = makeRecord({ line_id: docLines.length + 1, ...d }, "line_id");
        docLines.push(rec);
        return rec;
      }),
      destroy: vi.fn(async ({ where }) => {
        for (let i = docLines.length - 1; i >= 0; i--) {
          if (docLines[i].doc_id === Number(where.doc_id)) docLines.splice(i, 1);
        }
      }),
    },
    RetailStockMovement: {
      findAll: vi.fn(async () => movements),
      create: vi.fn(async (d) => {
        const rec = makeRecord({ movement_id: movements.length + 1, ...d }, "movement_id");
        movements.push(rec);
        return rec;
      }),
    },
    RetailSerial: {
      findAll: vi.fn(async ({ where }) => {
        if (where?.receive_doc_id) return serials.filter((s) => s.receive_doc_id === Number(where.receive_doc_id));
        if (where?.serial_no?.[Op.in]) {
          return serials.filter(
            (s) => s.product_id === Number(where.product_id) && where.serial_no[Op.in].includes(s.serial_no),
          );
        }
        return serials;
      }),
      create: vi.fn(async (d) => {
        const rec = makeRecord({ serial_id: serials.length + 1, ...d }, "serial_id");
        serials.push(rec);
        return rec;
      }),
    },
    sequelize: {
      query: vi.fn(async (sql, { replacements }) => {
        if (sql.includes("qty_on_hand = qty_on_hand +")) {
          const [inc, now, pid, wid] = replacements;
          const lvl = levelRecords.find((l) => l.product_id === pid && l.warehouse_id === wid);
          if (!lvl) return [[], { affectedRows: 0 }];
          lvl.qty_on_hand = Math.round((Number(lvl.qty_on_hand) + Number(inc)) * 1000) / 1000;
          lvl.updatedAt = now;
          return [[], { affectedRows: 1 }];
        }
        if (sql.includes("qty_on_hand = qty_on_hand -")) {
          const [dec, now, pid, wid, allowNeg, minQty] = replacements;
          const lvl = levelRecords.find((l) => l.product_id === pid && l.warehouse_id === wid);
          if (!lvl) return [[], { affectedRows: 0 }];
          if (!allowNeg && Number(lvl.qty_on_hand) < Number(minQty)) {
            return [[], { affectedRows: 0 }];
          }
          lvl.qty_on_hand = Math.round((Number(lvl.qty_on_hand) - Number(dec)) * 1000) / 1000;
          lvl.updatedAt = now;
          return [[], { affectedRows: 1 }];
        }
        return [[], { affectedRows: 0 }];
      }),
      transaction: async (fn) => fn({}),
    },
  };

  return { models, prodRecords, levelRecords, docs, docLines, movements, serials };
};

describe("Retail R2 Stock Engine", () => {
  it("computes weighted average across locations and resets when total on-hand <= 0", async () => {
    const { models, prodRecords } = makeStockHarness({
      products: [{ product_id: 1, code: "HW-00001", name: "Bit 6mm", tracking: "counted", avg_cost: 50 }],
      warehouses: [
        { warehouse_id: 1, name: "Main", is_default: true },
        { warehouse_id: 2, name: "Branch", is_default: false },
      ],
      levels: [
        { product_id: 1, warehouse_id: 1, qty_on_hand: -5, counted_at: new Date() },
        { product_id: 1, warehouse_id: 2, qty_on_hand: 0, counted_at: new Date() },
      ],
    });

    // Total on hand <= 0 -> new avg = received cost (100)
    await createReceiveDocument(models, 1, {
      warehouse_id: 1,
      supplier_name: "Ceylon Hardware",
      lines: [{ product_id: 1, qty: 10, unit_cost: 100 }],
      post: true,
    });
    expect(prodRecords[0].avg_cost).toBe(100);

    // Now on-hand across locations = 5; receive 5 at branch 2 at Rs 200 -> avg = (5*100 + 5*200) / 10 = 150
    await createReceiveDocument(models, 1, {
      warehouse_id: 2,
      supplier_name: "Ceylon Hardware",
      lines: [{ product_id: 1, qty: 5, unit_cost: 200 }],
      post: true,
    });
    expect(prodRecords[0].avg_cost).toBe(150);
  });

  it("spreads delivery charge across lines to the exact cent and converts pack units", async () => {
    const { models, levelRecords, docLines } = makeStockHarness({
      products: [
        {
          product_id: 1,
          code: "HW-00001",
          name: "Screw",
          tracking: "counted",
          Units: [{ unit_id: 10, unit_name: "box", factor: 25 }],
        },
        { product_id: 2, code: "HW-00002", name: "Nail", tracking: "counted", Units: [] },
      ],
    });

    const doc = await createReceiveDocument(models, 1, {
      warehouse_id: 1,
      supplier_name: "Lanka Tools",
      delivery_charge: 100.01,
      lines: [
        { product_id: 1, unit_id: 10, qty: 2, unit_cost: 500 }, // 50 pcs, value 1000
        { product_id: 2, qty: 10, unit_cost: 200 }, // 10 pcs, value 2000
      ],
      post: true,
    });

    expect(levelRecords.find((l) => l.product_id === 1).qty_on_hand).toBe(50);
    expect(doc.total_cost).toBe(3100.01);

    const line1 = docLines.find((l) => l.product_id === 1);
    const line2 = docLines.find((l) => l.product_id === 2);
    const totalFromLinesCents = addCents(
      toCents(line1.base_qty * line1.unit_cost),
      toCents(line2.base_qty * line2.unit_cost),
    );
    expect(totalFromLinesCents).toBe(310001);
  });

  it("enforces serial count and uniqueness on receive", async () => {
    const { models, serials } = makeStockHarness({
      products: [
        {
          product_id: 1,
          code: "HW-00001",
          name: "Bosch Grinder",
          tracking: "serial",
          serial_capture: "receive",
        },
        { product_id: 2, code: "HW-00002", name: "Bit", tracking: "counted" },
      ],
    });

    await expect(
      createReceiveDocument(models, 1, {
        supplier_name: "Bosch SL",
        lines: [{ product_id: 1, qty: 2, unit_cost: 15000, serials: ["SN-1"] }],
        post: true,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      createReceiveDocument(models, 1, {
        supplier_name: "Bosch SL",
        lines: [{ product_id: 2, qty: 1, unit_cost: 100, serials: ["BAD"] }],
        post: true,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await createReceiveDocument(models, 1, {
      supplier_name: "Bosch SL",
      lines: [{ product_id: 1, qty: 2, unit_cost: 15000, serials: ["SN-1", "SN-2"] }],
      post: true,
    });
    expect(serials).toHaveLength(2);

    // Duplicate serial across documents -> 409
    await expect(
      createReceiveDocument(models, 1, {
        supplier_name: "Bosch SL",
        lines: [{ product_id: 1, qty: 1, unit_cost: 15000, serials: ["SN-1"] }],
        post: true,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("handles block vs warn vs not-counted on decreases, and allows only 1 winner under concurrent block", async () => {
    // 1. Not counted (counted_at=null) never blocks even under block setting
    const h1 = makeStockHarness({
      products: [{ product_id: 1, name: "Item", tracking: "counted" }],
      retailSettings: { negativeStock: "block" },
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 0, counted_at: null }],
    });
    await postAdjustDocument(h1.models, 1, {
      reason: "damaged",
      lines: [{ product_id: 1, qty_change: -2 }],
    });
    expect(h1.levelRecords[0].qty_on_hand).toBe(-2);

    // 2. Warn allows counted item to go negative
    const h2 = makeStockHarness({
      products: [{ product_id: 1, name: "Item", tracking: "counted" }],
      retailSettings: { negativeStock: "warn" },
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 1, counted_at: new Date() }],
    });
    await postAdjustDocument(h2.models, 1, {
      reason: "lost",
      lines: [{ product_id: 1, qty_change: -3 }],
    });
    expect(h2.levelRecords[0].qty_on_hand).toBe(-2);

    // 3. Concurrent decreases under block: qty_on_hand=1, two simultaneous -1 -> exactly 1 succeeds
    const h3 = makeStockHarness({
      products: [{ product_id: 1, name: "Item", tracking: "counted" }],
      retailSettings: { negativeStock: "block" },
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 1, counted_at: new Date() }],
    });
    const [r1, r2] = await Promise.allSettled([
      postAdjustDocument(h3.models, 1, { reason: "damaged", lines: [{ product_id: 1, qty_change: -1 }] }),
      postAdjustDocument(h3.models, 1, { reason: "damaged", lines: [{ product_id: 1, qty_change: -1 }] }),
    ]);
    const ok = [r1, r2].filter((r) => r.status === "fulfilled");
    const fail = [r1, r2].filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(fail).toHaveLength(1);
    expect(fail[0].reason.statusCode).toBe(409);
    expect(h3.levelRecords[0].qty_on_hand).toBe(0);
  });

  it("records count differences, sets counted_at on opening, and handles drafts/version/idempotent post", async () => {
    const { models, prodRecords, levelRecords, movements } = makeStockHarness({
      products: [{ product_id: 1, name: "Pipe", tracking: "counted", avg_cost: 0 }],
    });

    // Opening sets counted_at and avg_cost when product had 0
    await postOpeningDocument(models, 1, {
      lines: [{ product_id: 1, qty: 20, unit_cost: 120 }],
    });
    expect(levelRecords[0].qty_on_hand).toBe(20);
    expect(levelRecords[0].counted_at).toBeTruthy();
    expect(prodRecords[0].avg_cost).toBe(120);

    // Count computes difference (-5)
    const countDoc = await postCountDocument(models, 1, {
      lines: [{ product_id: 1, counted_qty: 15 }],
    });
    expect(countDoc.line_summaries[0]).toEqual({
      product_id: 1,
      system_qty: 20,
      counted_qty: 15,
      difference: -5,
    });
    expect(levelRecords[0].qty_on_hand).toBe(15);

    // Draft changes no stock; version conflict gives 409
    const draft = await createReceiveDocument(models, 1, {
      supplier_name: "Anton",
      lines: [{ product_id: 1, qty: 10, unit_cost: 130 }],
      post: false,
    });
    expect(levelRecords[0].qty_on_hand).toBe(15);

    await expect(
      updateReceiveDraft(models, draft.doc_id, 1, { supplier_name: "Anton", version: 99 }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // Post once, then post again idempotently -> stock only added once
    await postReceiveDocument(models, draft.doc_id, 1, { version: 1 });
    expect(levelRecords[0].qty_on_hand).toBe(25);
    const movCountAfterPost = movements.length;

    const secondPost = await postReceiveDocument(models, draft.doc_id, 1, {});
    expect(secondPost.status).toBe("posted");
    expect(levelRecords[0].qty_on_hand).toBe(25);
    expect(movements.length).toBe(movCountAfterPost);
  });

  it("enforces back-dating, booksClosedUntil, cost stripping, levels delta, and integrity check", async () => {
    const now = new Date("2026-11-23T12:00:00Z");
    const { models, levelRecords } = makeStockHarness({
      products: [{ product_id: 1, name: "Item", tracking: "counted" }],
      retailSettings: { booksClosedUntil: "2026-11-15" },
    });

    // Future date refused (400)
    await expect(
      postAdjustDocument(
        models,
        1,
        { reason: "found", occurred_at: "2026-11-24T12:00:00Z", lines: [{ product_id: 1, qty_change: 1 }] },
        { now },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    // Books closed refused (422)
    await expect(
      postAdjustDocument(
        models,
        1,
        { reason: "found", occurred_at: "2026-11-15T10:00:00Z", lines: [{ product_id: 1, qty_change: 1 }] },
        { now },
      ),
    ).rejects.toMatchObject({ statusCode: 422 });

    // >24h backdate without retail:backdate refused (403)
    await expect(
      postAdjustDocument(
        models,
        1,
        { reason: "found", occurred_at: "2026-11-20T10:00:00Z", lines: [{ product_id: 1, qty_change: 1 }] },
        { now },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    // With retail:backdate succeeds
    await postAdjustDocument(
      models,
      1,
      { reason: "found", occurred_at: "2026-11-20T10:00:00Z", lines: [{ product_id: 1, qty_change: 5 }] },
      { now, effectivePermissions: new Set(["retail:backdate"]) },
    );

    // Cost stripping removes R2 cost fields
    const stripped = stripCostFields(
      { unit_cost: 100, entered_unit_cost: 500, total_cost: 550, delivery_charge: 50, stock_value: 5000, qty: 5 },
      false,
    );
    expect(stripped).toEqual({ qty: 5 });

    // Levels delta returns server_time = now - 5s and changed rows
    const delta = await getStockLevelsDelta(models, { since: "2020-01-01T00:00:00Z" });
    expect(delta.levels).toHaveLength(1);
    expect(new Date(delta.server_time).getTime()).toBeLessThanOrEqual(Date.now() - 4000);

    // Integrity check clean, then finds planted mismatch
    expect((await checkStockIntegrity(models)).ok).toBe(true);
    levelRecords[0].qty_on_hand = 999;
    const broken = await checkStockIntegrity(models);
    expect(broken.ok).toBe(false);
    expect(broken.mismatches[0]).toMatchObject({
      product_id: 1,
      warehouse_id: 1,
      movements_sum: 5,
      qty_on_hand: 999,
    });
  });

  it("posting uses the item's current average cost, not one loaded before the lock", async () => {
    const { models, prodRecords } = makeStockHarness({
      products: [{ product_id: 1, code: "HW-00001", name: "Bit 6mm", tracking: "counted", avg_cost: 120 }],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 10, counted_at: new Date() }],
    });
    // The first product read (before the lock) sees a stale avg_cost of 50, as if another delivery
    // committed in between. The locked re-read (it has an `order`) sees the real 120.
    const realFindAll = models.RetailProduct.findAll;
    models.RetailProduct.findAll = vi.fn(async (q) => {
      const rows = await realFindAll(q);
      if (q?.order) return rows;
      return rows.map((r) => makeRecord({ ...r.toJSON(), avg_cost: 50 }, "product_id"));
    });
    await createReceiveDocument(models, 1, {
      warehouse_id: 1,
      supplier_name: "Ceylon Hardware",
      lines: [{ product_id: 1, qty: 10, unit_cost: 200 }],
      post: true,
    });
    // (10 × 120 + 10 × 200) / 20 = 160. With the stale 50 it would have been 125.
    const lockedRead = models.RetailProduct.findAll.mock.calls.find(([q]) => q?.order);
    expect(lockedRead).toBeTruthy();
    expect(prodRecords[0].avg_cost).toBe(160);
  });

  it("a draft with no chosen date is dated when posted, so posting it days later is not back-dating", async () => {
    const { models, docs } = makeStockHarness({
      products: [{ product_id: 1, code: "HW-00001", name: "Bit 6mm", tracking: "counted" }],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 0, counted_at: new Date() }],
    });
    const monday = new Date("2026-11-16T09:00:00Z");
    const wednesday = new Date("2026-11-18T10:00:00Z");
    const draft = await createReceiveDocument(
      models,
      1,
      { warehouse_id: 1, supplier_name: "Ceylon Hardware", lines: [{ product_id: 1, qty: 5, unit_cost: 100 }] },
      { now: monday },
    );
    const docId = draft.doc_id ?? draft.document?.doc_id ?? docs[0].doc_id;
    const stored = docs.find((d) => d.doc_id === docId) ?? docs[0];
    stored.createdAt = monday; // the database sets this on insert
    // The cashier (no retail:backdate) posts it on Wednesday: allowed, and dated Wednesday.
    await postReceiveDocument(models, stored.doc_id, 1, {}, { now: wednesday });
    expect(stored.status).toBe("posted");
    expect(new Date(stored.occurred_at).getTime()).toBe(wednesday.getTime());
  });

  it("never updates or deletes RETAIL_STOCK_MOVEMENTS anywhere in src/modules/retail", () => {
    const retailDir = path.resolve(import.meta.dirname, "../../src/modules/retail");
    const walk = (dir) => {
      const out = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) out.push(full);
      }
      return out;
    };
    const violations = [];
    for (const file of walk(retailDir)) {
      const src = fs.readFileSync(file, "utf8");
      if (/RetailStockMovement\.(update|destroy)|RETAIL_STOCK_MOVEMENTS.*(UPDATE|DELETE)|(UPDATE|DELETE).*RETAIL_STOCK_MOVEMENTS/i.test(src)) {
        violations.push(path.relative(retailDir, file));
      }
    }
    expect(violations).toEqual([]);
  });
});
