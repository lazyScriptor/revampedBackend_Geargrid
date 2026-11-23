import { describe, it, expect, vi } from "vitest";
import { Op } from "sequelize";
import {
  generateName,
  generateSinhalaName,
  buildSearchText,
  parseSearchQueryWords,
  escapeLike,
  nextProductCode,
  withProductCodeRetry,
  ensureStarterCatalog,
  stripCostFields,
  createFamily,
  deleteCategory,
  mergeCategoryInto,
  learnBarcode,
  lookupProductByCode,
  getPosCatalog,
  listProducts,
  updateRetailSettings,
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

describe("Retail R1 Catalogue", () => {
  describe("Naming, Sinhala naming, and code generation", () => {
    it("generates English and Sinhala names from item_name without duplicating subCategory, and falls back to subCategory when item_name is missing", () => {
      expect(
        generateName({
          brand: "SALI",
          subCategory: "Steel",
          itemName: "Steel Drill Bit",
          variant: "6",
          unit: "mm",
        }),
      ).toBe("SALI Steel Drill Bit 6mm");

      expect(
        generateName({
          brand: "SALI",
          subCategory: "Cutting wheels",
          itemName: "Cutting Wheel",
          variant: '4"',
        }),
      ).toBe('SALI Cutting Wheel 4"');

      // Fallback when item_name is missing: uses subCategory as-is, never both
      expect(
        generateName({
          brand: "Bosch",
          subCategory: "Lighting",
          variant: "12W",
        }),
      ).toBe("Bosch Lighting 12W");

      // Already has unit on variant
      expect(
        generateName({
          brand: "SALI",
          subCategory: "Steel",
          itemName: "Steel Drill Bit",
          variant: "6mm",
          unit: "mm",
        }),
      ).toBe("SALI Steel Drill Bit 6mm");

      expect(
        generateSinhalaName({
          brand: "SALI",
          subCategorySi: "වානේ",
          itemNameSi: "වානේ විදුම් කටුව",
          variant: "6",
          unit: "mm",
        }),
      ).toBe("SALI වානේ විදුම් කටුව 6mm");
    });

    it("computes next sequential HW-00001 code and retries up to 5 times on unique clash", async () => {
      const models = {
        RetailProduct: {
          findAll: vi.fn(async () => [{ code: "HW-00001" }, { code: "HW-00012" }, { code: "OTHER-99" }]),
        },
      };
      expect(await nextProductCode(models, "HW-")).toBe("HW-00013");

      let attempts = 0;
      const res = await withProductCodeRetry(async () => {
        attempts += 1;
        if (attempts < 3) {
          const err = new Error("dup");
          err.name = "SequelizeUniqueConstraintError";
          throw err;
        }
        return "ok";
      });
      expect(res).toBe("ok");
      expect(attempts).toBe(3);
    });
  });

  describe("buildSearchText & query word parsing", () => {
    it("indexes size forms (6mm, 6 mm, 6, 6.0) and injects matching alias terms", () => {
      const text = buildSearchText(
        { code: "HW-00001", name: "SALI Steel Drill Bit 6mm", variant_label: "6" },
        {
          category: { name: "Drill bits", name_si: "විදුම් කටු" },
          subCategory: { name: "Steel", name_si: "වානේ" },
          family: { name: "SALI Steel Drill Bit", option_unit: "mm" },
          brand: { name: "SALI" },
          units: [{ unit_name: "box" }],
          barcodes: [{ barcode: "8901234567890" }],
          aliases: [
            { term: "hss", means: "steel" },
            { term: "masonry", means: "concrete" },
          ],
        },
      );

      expect(text).toContain("6mm");
      expect(text).toContain("6 mm");
      expect(text).toContain("6");
      expect(text).toContain("6.0");
      expect(text).toContain("hss");
      expect(text).not.toContain("masonry");
      expect(text).toContain("8901234567890");
    });

    it("expands aliases and escapes % and _ in q parser", () => {
      const words = parseSearchQueryWords("6mm hss sali", [{ term: "hss", means: "steel" }]);
      expect(words).toEqual(["6mm", "steel", "sali"]);
      expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    });

    it("listProducts builds ANDed LIKE clauses for words in any order and escapes wildcards", async () => {
      const findAndCountAll = vi.fn(async () => ({ count: 0, rows: [] }));
      const models = {
        RetailSearchAlias: { findAll: vi.fn(async () => [{ term: "hss", means: "steel" }]) },
        RetailCategory: { findAll: vi.fn(async () => []) },
        RetailBrand: {},
        RetailFamily: {},
        RetailProductUnit: {},
        RetailBarcode: {},
        RetailProduct: { findAndCountAll },
      };

      await listProducts(models, { q: "hss 100%" });
      const where = findAndCountAll.mock.calls[0][0].where;
      expect(where[Op.and]).toEqual([
        { search_text: { [Op.like]: "%steel%" } },
        { search_text: { [Op.like]: "%100\\%%" } },
      ]);
    });
  });

  describe("ensureStarterCatalog", () => {
    it("seeds starter categories and aliases once, then skips when categories exist", async () => {
      const cats = [];
      const aliases = [];
      const models = {
        RetailCategory: {
          count: vi.fn(async () => cats.length),
          create: vi.fn(async (d) => {
            const rec = { category_id: cats.length + 1, ...d };
            cats.push(rec);
            return rec;
          }),
        },
        RetailSearchAlias: {
          findOne: vi.fn(async ({ where }) => aliases.find((a) => a.term === where.term) || null),
          create: vi.fn(async (d) => {
            const rec = { alias_id: aliases.length + 1, ...d };
            aliases.push(rec);
            return rec;
          }),
        },
      };

      const first = await ensureStarterCatalog(models);
      expect(first.seeded).toBe(true);
      expect(first.categories).toBeGreaterThan(50);
      expect(first.aliases).toBeGreaterThan(15);
      expect(cats.find((c) => c.name === "Cutting wheels")?.item_name).toBe("Cutting Wheel");

      // Backfills item_name / item_name_si when existing starter categories lack them
      const cuttingRow = cats.find((c) => c.name === "Cutting wheels");
      cuttingRow.item_name = null;
      cuttingRow.item_name_si = null;
      models.RetailCategory.findAll = vi.fn(async () =>
        cats.filter((c) => c.item_name === null),
      );
      models.RetailCategory.update = vi.fn(async (patch, { where }) => {
        const target = cats.find((c) => c.category_id === where.category_id);
        if (target) Object.assign(target, patch);
        return [1];
      });

      const second = await ensureStarterCatalog(models);
      expect(second).toEqual({ seeded: false, categories: 0, aliases: 0 });
      expect(cuttingRow.item_name).toBe("Cutting Wheel");
      expect(cuttingRow.item_name_si).toBe("කැපුම් තැටිය");
    });
  });

  describe("Family all-or-nothing creation, category delete/merge, barcode learn & lookup", () => {
    it("rolls back entire family creation when any variant fails", async () => {
      const families = [];
      const products = [];
      const models = {
        TenantConfig: { findOne: vi.fn(async () => null) },
        RetailCategory: { findByPk: vi.fn(async () => ({ category_id: 2, parent_id: 1, name: "Steel" })) },
        RetailBrand: { findByPk: vi.fn(async () => ({ brand_id: 1, name: "SALI" })) },
        RetailSearchAlias: { findAll: vi.fn(async () => []) },
        RetailFamily: {
          create: vi.fn(async (d) => {
            const f = makeRecord({ family_id: families.length + 1, ...d }, "family_id");
            families.push(f);
            return f;
          }),
        },
        RetailProduct: {
          findAll: vi.fn(async () => []),
          create: vi.fn(async (d) => {
            const p = makeRecord({ product_id: products.length + 1, ...d }, "product_id");
            products.push(p);
            return p;
          }),
        },
        RetailProductUnit: { destroy: vi.fn(async () => {}) },
        RetailBarcode: { findAll: vi.fn(async () => []) },
        sequelize: {
          transaction: async (fn) => {
            const snapF = families.length;
            const snapP = products.length;
            try {
              return await fn({});
            } catch (err) {
              families.length = snapF;
              products.length = snapP;
              throw err;
            }
          },
        },
      };

      // Second variant missing sell_price -> entire transaction rolls back
      await expect(
        createFamily(models, 1, {
          name: "SALI Steel Drill Bit",
          category_id: 2,
          brand_id: 1,
          variants: [
            { variant_label: "6mm", sell_price: 250 },
            { variant_label: "8mm" },
          ],
        }),
      ).rejects.toMatchObject({ statusCode: 400 });

      expect(families).toHaveLength(0);
      expect(products).toHaveLength(0);
    });

    it("refuses deleting a category with items (409) and moves items on merge", async () => {
      const cats = [
        makeRecord({ category_id: 10, parent_id: 1, name: "Old" }, "category_id"),
        makeRecord({ category_id: 20, parent_id: 1, name: "Target" }, "category_id"),
      ];
      const prods = [
        makeRecord({ product_id: 100, category_id: 10, name: "Bit 6mm", code: "HW-00001" }, "product_id"),
      ];
      const fams = [{ family_id: 5, category_id: 10 }];

      const models = {
        RetailCategory: {
          findByPk: vi.fn(async (id) => cats.find((c) => c.category_id === Number(id)) || null),
          count: vi.fn(async () => 0),
          update: vi.fn(async () => [0]),
        },
        RetailProduct: {
          count: vi.fn(async ({ where }) => prods.filter((p) => p.category_id === where.category_id).length),
          findAll: vi.fn(async ({ where }) => {
            if (where.category_id === 10) return prods.filter((p) => p.category_id === 10);
            if (where.product_id?.[Op.in]) return prods.filter((p) => where.product_id[Op.in].includes(p.product_id));
            return [];
          }),
          update: vi.fn(async (patch, { where }) => {
            for (const p of prods) if (p.category_id === where.category_id) Object.assign(p, patch);
            return [1];
          }),
        },
        RetailFamily: {
          count: vi.fn(async ({ where }) => fams.filter((f) => f.category_id === where.category_id).length),
          update: vi.fn(async (patch, { where }) => {
            for (const f of fams) if (f.category_id === where.category_id) Object.assign(f, patch);
            return [1];
          }),
        },
        RetailBrand: {},
        RetailProductUnit: {},
        RetailBarcode: {},
        RetailSearchAlias: { findAll: vi.fn(async () => []) },
      };

      await expect(deleteCategory(models, 10)).rejects.toMatchObject({ statusCode: 409 });

      const merged = await mergeCategoryInto(models, 10, 20);
      expect(merged.moved_products).toBe(1);
      expect(prods[0].category_id).toBe(20);
      expect(fams[0].category_id).toBe(20);
      expect(cats[0]._destroyed).toBe(true);
    });

    it("rejects conflicting barcode learn with 409 and returns pack unit on lookup", async () => {
      const boxUnit = { unit_id: 3, product_id: 1, unit_name: "box", factor: 100 };
      const prod1 = { product_id: 1, name: "SALI Nails 2\"", code: "HW-00001" };
      const prod2 = { product_id: 2, name: "Tolsen Nails 2\"", code: "HW-00002" };
      const barcodes = [
        { barcode: "890000000001", product_id: 1, unit_id: 3, Unit: boxUnit, RetailProduct: prod1 },
      ];

      const models = {
        RetailProduct: {
          findByPk: vi.fn(async (id) => (Number(id) === 2 ? prod2 : prod1)),
          findOne: vi.fn(async () => null),
        },
        RetailProductUnit: {},
        RetailBarcode: {
          findByPk: vi.fn(async (code) => barcodes.find((b) => b.barcode === code) || null),
        },
      };

      await expect(
        learnBarcode(models, { barcode: "890000000001", product_id: 2 }),
      ).rejects.toMatchObject({ statusCode: 409 });

      const found = await lookupProductByCode(models, "890000000001");
      expect(found.matched_by).toBe("barcode");
      expect(found.product.product_id).toBe(1);
      expect(found.unit).toEqual(boxUnit);
    });
  });

  describe("Cost stripping, pos/catalog delta sync, and retail settings units", () => {
    it("strips avg_cost, last_cost, and margin fields when user lacks retail:cost_view", () => {
      const payload = {
        products: [
          { product_id: 1, name: "Bit", sell_price: 200, avg_cost: 120, last_cost: 125, margin: 80 },
        ],
      };
      const stripped = stripCostFields(payload, false);
      expect(stripped.products[0]).toEqual({ product_id: 1, name: "Bit", sell_price: 200 });

      const kept = stripCostFields(payload, true);
      expect(kept.products[0].avg_cost).toBe(120);
      expect(kept.products[0].last_cost).toBe(125);
    });

    it("returns delta products and archived_ids for pos/catalog?since=", async () => {
      const since = "2026-11-23T10:00:00.000Z";
      const allProducts = [
        { product_id: 1, is_active: true, updatedAt: new Date("2026-11-23T09:00:00Z") },
        { product_id: 2, is_active: true, updatedAt: new Date("2026-11-23T11:00:00Z") },
        { product_id: 3, is_active: false, updatedAt: new Date("2026-11-23T11:30:00Z") },
      ];
      const models = {
        RetailProduct: {
          findAll: vi.fn(async ({ where }) => {
            return allProducts.filter((p) => {
              if (p.is_active !== where.is_active) return false;
              if (where.updatedAt?.[Op.gt]) return p.updatedAt > where.updatedAt[Op.gt];
              return true;
            });
          }),
        },
        RetailProductUnit: {},
        RetailBarcode: {},
        RetailCategory: { findAll: vi.fn(async () => []) },
        RetailBrand: { findAll: vi.fn(async () => []) },
        RetailFamily: { findAll: vi.fn(async () => []) },
      };

      const before = Date.now();
      const delta = await getPosCatalog(models, { since });
      const after = Date.now();
      const serverTs = new Date(delta.server_time).getTime();
      expect(serverTs).toBeGreaterThanOrEqual(before - 5000);
      expect(serverTs).toBeLessThanOrEqual(after - 5000);
      expect(delta.products.map((p) => p.product_id)).toEqual([2]);
      expect(delta.archived_ids).toEqual([3]);
    });

    it("validates retail settings units list", async () => {
      const configRow = makeRecord({ custom_settings: {} });
      const models = { TenantConfig: { findOne: vi.fn(async () => configRow) } };

      const updated = await updateRetailSettings(models, {
        units: { base: ["pcs", "kg"], pack: ["box", "coil"] },
      });
      expect(updated.units).toEqual({ base: ["pcs", "kg"], pack: ["box", "coil"] });

      await expect(
        updateRetailSettings(models, { units: { base: [] } }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });
});
