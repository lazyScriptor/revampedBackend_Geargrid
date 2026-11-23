import dotenv from "dotenv";
import { Op } from "sequelize";

dotenv.config({ override: false });

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const env = (process.env.NODE_ENV || "development").toLowerCase();
const host = (process.env.HOST || process.env.DB_HOST || "localhost").toLowerCase();

if (env === "production") {
  console.error("Refusing to run: NODE_ENV is 'production'.");
  process.exit(1);
}
if (!LOCAL_HOSTS.has(host)) {
  console.error(`Refusing to run: HOST (${host}) must be localhost or 127.0.0.1.`);
  process.exit(1);
}

const args = process.argv.slice(2);
const dbName = args.find((a) => !a.startsWith("--"));
const withPerf = args.includes("--perf");
const withReset = args.includes("--reset");
const withStock = args.includes("--stock");

if (!dbName) {
  console.error("Usage: NODE_ENV=development node scripts/seed-retail-demo.js <db_name> [--reset] [--perf] [--stock]");
  process.exit(1);
}

const DEMO_MARKER = "[demo-seed]";

// Realistic brand mapping per parent category / sub-category
const SUBCAT_BRANDS = {
  // Drill bits, abrasives, power tools, accessories, hand tools
  "Drill bits": ["SALI", "Tolsen", "Ingco", "Bosch", "Makita"],
  "Abrasives": ["SALI", "Tolsen", "Ingco", "Bosch", "Makita"],
  "Power tools": ["Bosch", "Makita", "Ingco", "Tolsen"],
  "Power tool accessories": ["SALI", "Bosch", "Makita", "Ingco"],
  "Hand tools": ["Tolsen", "Ingco", "SALI"],
  // Plumbing
  "PVC pipes": ["S-lon", "Anton"],
  "PVC fittings": ["S-lon", "Anton"],
  "GI pipes & fittings": ["Anton", "Lanka"],
  "Taps & valves": ["Anton", "Lanka"],
  // Electrical
  "Cables & wires": ["Kelani Cables"],
  "Switches & sockets": ["Orange", "Lanka"],
  "Breakers & DB": ["Orange", "Lanka"],
  "Conduits & trunking": ["S-lon", "Anton"],
  "Lighting": ["Orange", "Lanka"],
  // Paint
  "Paint & finishes": ["Dulux", "Nippon", "Robbialac"],
  // Building materials
  "Cement": ["Tokyo Cement", "Holcim"],
  "Steel bars": ["Lanka"],
  "Wire mesh": ["Lanka"],
  // Fasteners, adhesives, safety, garden, locks
  "Fasteners": ["Tolsen", "Ingco", "Lanka"],
  "Adhesives & sealants": ["S-lon", "Anton", "Lanka"],
  "Safety": ["Tolsen", "Ingco", "Lanka"],
  "Garden": ["S-lon", "Tolsen", "Ingco"],
  "Locks & hardware fittings": ["Tolsen", "Lanka"],
};

// Realistic base LKR price & unit rules per sub-category / parent
const PRICE_AND_UNIT_RULES = {
  "Drill bits": { base: 180, unit: "pcs", decimal: false },
  "Abrasives": { base: 220, unit: "pcs", decimal: false },
  "Sandpaper": { base: 90, unit: "sheet", decimal: false, flat: true },
  "Nails": { base: 650, unit: "kg", decimal: true, pack: { unit_name: "box", factor: 25 } },
  "Wood screws": { base: 12, unit: "pcs", decimal: false, pack: { unit_name: "box", factor: 100 } },
  "Drywall screws": { base: 10, unit: "pcs", decimal: false, pack: { unit_name: "box", factor: 100 } },
  "Bolts & nuts": { base: 45, unit: "pcs", decimal: false, pack: { unit_name: "box", factor: 100 } },
  "Wall plugs & anchors": { base: 15, unit: "pcs", decimal: false, pack: { unit_name: "box", factor: 100 } },
  "PVC pipes": { base: 45, unit: "ft", decimal: true, pack: { unit_name: "length", factor: 20 } },
  "PVC fittings": { base: 85, unit: "pcs", decimal: false },
  "GI pipes & fittings": { base: 120, unit: "ft", decimal: true, pack: { unit_name: "length", factor: 20 } },
  "Taps & valves": { base: 950, unit: "pcs", decimal: false },
  "Cables & wires": { base: 95, unit: "m", decimal: true, pack: { unit_name: "coil", factor: 90 } },
  "Switches & sockets": { base: 480, unit: "pcs", decimal: false },
  "Breakers & DB": { base: 1450, unit: "pcs", decimal: false },
  "Conduits & trunking": { base: 22, unit: "ft", decimal: true, pack: { unit_name: "length", factor: 20 } },
  "Lighting": { base: 650, unit: "pcs", decimal: false },
  "Emulsion": { base: 2400, unit: "tin", decimal: false },
  "Enamel": { base: 1650, unit: "tin", decimal: false },
  "Primers & thinners": { base: 1350, unit: "tin", decimal: false },
  "Brushes & rollers": { base: 280, unit: "pcs", decimal: false },
  "Silicone": { base: 950, unit: "pcs", decimal: false },
  "PVC solvent cement": { base: 450, unit: "pcs", decimal: false },
  "Wood glue": { base: 550, unit: "pcs", decimal: false },
  "Epoxy": { base: 680, unit: "pcs", decimal: false },
  "Tapes": { base: 220, unit: "roll", decimal: false },
  "Hand tools": { base: 1200, unit: "pcs", decimal: false },
  "Power tools": { base: 16500, unit: "pcs", decimal: false },
  "Power tool accessories": { base: 850, unit: "pcs", decimal: false },
  "Safety": { base: 450, unit: "pair", decimal: false },
  "Gloves": { base: 450, unit: "pair", decimal: false, flat: true },
  "Safety boots": { base: 4800, unit: "pair", decimal: false, flat: true },
  "Safety glasses": { base: 550, unit: "pcs", decimal: false },
  "Helmets": { base: 1650, unit: "pcs", decimal: false },
  "Masks": { base: 180, unit: "pcs", decimal: false },
  "Cement": { base: 2450, unit: "bag", decimal: false },
  "Steel bars": { base: 1850, unit: "pcs", decimal: false },
  "Wire mesh": { base: 4200, unit: "roll", decimal: false },
  "Hose pipes": { base: 85, unit: "m", decimal: true, pack: { unit_name: "coil", factor: 90 } },
  "Garden": { base: 1400, unit: "pcs", decimal: false },
  "Padlocks": { base: 950, unit: "pcs", decimal: false },
  "Door locks": { base: 3400, unit: "set", decimal: false },
  "Hinges": { base: 320, unit: "pcs", decimal: false, pack: { unit_name: "box", factor: 25 } },
  "Tower bolts": { base: 290, unit: "pcs", decimal: false },
};

const BRAND_MULTIPLIER = {
  Bosch: 1.45,
  Makita: 1.5,
  Dulux: 1.25,
  Nippon: 1.15,
  Ingco: 1.1,
  Tolsen: 1.05,
  "S-lon": 1.1,
  "Kelani Cables": 1.15,
};

/** Valid EAN-13 barcode with 479 Sri Lanka prefix and Modulo-10 check digit. */
const makeEan13 = (seq) => {
  const body = `479000${String(seq).padStart(6, "0")}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return `${body}${check}`;
};

const sizeScale = (variant, idx) => {
  // Sizes are listed smallest first, so price follows the position in the list. (Mixing a
  // fraction rule with a position rule made 1" pipe cheaper than 1/2".)
  const v = variant.toLowerCase();
  const num = v.match(/(\d+(?:\.\d+)?)/);
  if (num && v.includes("ml")) return Math.max(0.45, Number(num[1]) / 500);
  if (num && /\d\s*l$/.test(v)) return Math.max(1, Number(num[1]) * 0.9);
  return 0.8 + idx * 0.3;
};

const roundLkr = (n) => Math.max(10, Math.round(n / 10) * 10);

(async () => {
  try {
    const { masterSequelize, getTenantConnection } = await import("../src/config/database.js");
    const { initMasterModels } = await import("../src/models/master/index.js");
    const { initTenantModels } = await import("../src/models/index.js");
    const { ensureStarterCatalog } = await import("../src/modules/retail/catalog/starterService.js");
    const { parseJsonField } = await import("../src/utils/jsonFields.js");
    const {
      buildSearchText,
      generateName,
      generateSinhalaName,
    } = await import("../src/modules/retail/catalog/naming.js");

    await masterSequelize.authenticate();
    const { Tenant } = initMasterModels(masterSequelize);
    const tenant = await Tenant.findOne({ where: { db_name: dbName } });
    if (!tenant) {
      console.error(`Tenant not found in geargrid_master: ${dbName}`);
      process.exit(1);
    }

    const conn = await getTenantConnection(
      tenant.db_name,
      tenant.db_user,
      tenant.encrypted_db_pass,
      tenant.db_host,
    );
    const models = initTenantModels(conn);

    await ensureStarterCatalog(models);

    if (withReset) {
      const demoProducts = await models.RetailProduct.findAll({
        where: { created_via: "import", description: DEMO_MARKER },
        attributes: ["product_id", "family_id"],
        raw: true,
      });
      const demoIds = demoProducts.map((p) => p.product_id);
      if (demoIds.length > 0) {
        await models.RetailBarcode.destroy({ where: { product_id: { [Op.in]: demoIds } } });
        await models.RetailProductUnit.destroy({ where: { product_id: { [Op.in]: demoIds } } });
        await models.RetailProduct.destroy({ where: { product_id: { [Op.in]: demoIds } } });
      }
      // Remove empty families left behind by demo products
      const allFamilies = await models.RetailFamily.findAll({ attributes: ["family_id"], raw: true });
      for (const f of allFamilies) {
        const count = await models.RetailProduct.count({ where: { family_id: f.family_id } });
        if (count === 0) {
          await models.RetailFamily.destroy({ where: { family_id: f.family_id } });
        }
      }
      console.log(`🔄 Reset removed ${demoIds.length} previous demo products.`);
    }

    // Ensure all realistic brands exist
    const allBrandNames = [
      ...new Set(Object.values(SUBCAT_BRANDS).flat()),
    ];
    const brandByName = new Map();
    for (const bName of allBrandNames) {
      const [b] = await models.RetailBrand.findOrCreate({
        where: { name: bName },
        defaults: { name: bName, is_active: true },
      });
      brandByName.set(bName, b);
    }

    const [categories, aliases, existingProducts] = await Promise.all([
      models.RetailCategory.findAll({ raw: true }),
      models.RetailSearchAlias.findAll({ raw: true }),
      models.RetailProduct.findAll({ attributes: ["code"], raw: true }),
    ]);

    const catsById = new Map(categories.map((c) => [c.category_id, c]));
    const subCats = categories.filter((c) => c.parent_id !== null);

    let maxCodeNum = 0;
    for (const p of existingProducts) {
      if (p.code?.startsWith("HW-")) {
        const n = Number(p.code.slice(3));
        if (Number.isInteger(n) && n > maxCodeNum) maxCodeNum = n;
      }
    }
    const allocCode = () => {
      maxCodeNum += 1;
      return `HW-${String(maxCodeNum).padStart(5, "0")}`;
    };

    let createdFamilies = 0;
    let createdProducts = 0;
    let createdUnits = 0;
    let createdBarcodes = 0;

    const shouldSeedCatalog = withReset || existingProducts.length === 0;
    const productRows = [];
    const packCandidates = [];
    let barcodeSeq = maxCodeNum + 1;

    if (shouldSeedCatalog) {
      for (const sub of subCats) {
      const parent = catsById.get(sub.parent_id);
      const allowedBrands =
        SUBCAT_BRANDS[sub.name] || SUBCAT_BRANDS[parent?.name] || ["Lanka"];
      const rule =
        PRICE_AND_UNIT_RULES[sub.name] ||
        PRICE_AND_UNIT_RULES[parent?.name] || {
          base: 500,
          unit: sub.default_unit || "pcs",
          decimal: false,
        };

      const parsedAttrs = parseJsonField(sub.attributes);
      const parsedUsual = parseJsonField(sub.usual_sizes);
      const variantAttr = Array.isArray(parsedAttrs)
        ? parsedAttrs.find((a) => a.variant)
        : null;
      const rawVariants =
        variantAttr?.values?.length > 0
          ? variantAttr.values.map((v) =>
              variantAttr.unit && !String(v).endsWith(variantAttr.unit) && variantAttr.unit !== "inch"
                ? `${v}${variantAttr.unit}`
                : String(v),
            )
          : Array.isArray(parsedUsual) && parsedUsual.length > 0
            ? parsedUsual
            : ["Standard"];

      for (const bName of allowedBrands) {
        const brand = brandByName.get(bName);
        const familyName = generateName({
          brand: brand.name,
          itemName: sub.item_name || sub.name,
          subCategory: sub.name,
        });
        const familyNameSi = generateSinhalaName({
          brand: brand.name,
          itemNameSi: sub.item_name_si || sub.name_si || "",
          subCategorySi: sub.name_si || "",
        });

        const family = await models.RetailFamily.create({
          name: familyName,
          name_si: familyNameSi || null,
          category_id: sub.category_id,
          brand_id: brand.brand_id,
          option_label: variantAttr?.name || "Size",
          option_unit: null,
        });
        createdFamilies += 1;

        const brandMult = BRAND_MULTIPLIER[brand.name] || 1.0;

        for (let idx = 0; idx < rawVariants.length; idx++) {
          const variant = String(rawVariants[idx]);
          const code = allocCode();
          const sellPrice = roundLkr(rule.base * brandMult * (rule.flat ? 1 : sizeScale(variant, idx)));
          const contractorPrice = roundLkr(sellPrice * 0.9); // ~10% below retail
          const avgCost = Math.round(sellPrice * 0.74 * 100) / 100;

          const name = generateName({
            brand: brand.name,
            itemName: sub.item_name || sub.name,
            subCategory: sub.name,
            variant,
          });
          const nameSi = generateSinhalaName({
            brand: brand.name,
            itemNameSi: sub.item_name_si || sub.name_si || "",
            subCategorySi: sub.name_si || "",
            variant,
          });

          const barcode = idx % 2 === 0 ? makeEan13(barcodeSeq++) : null;
          const searchText = buildSearchText(
            { code, name, name_si: nameSi, variant_label: variant },
            {
              category: parent || sub,
              subCategory: parent ? sub : null,
              family,
              brand,
              units: rule.pack ? [rule.pack.unit_name] : [],
              barcodes: barcode ? [barcode] : [],
              aliases,
            },
          );

          productRows.push({
            code,
            name,
            name_si: nameSi || null,
            family_id: family.family_id,
            variant_label: variant,
            category_id: sub.category_id,
            brand_id: brand.brand_id,
            tracking: "counted",
            base_unit: rule.unit,
            allow_decimal: Boolean(rule.decimal),
            sell_price: sellPrice,
            contractor_price: contractorPrice,
            avg_cost: avgCost,
            last_cost: avgCost,
            reorder_level: 10,
            description: DEMO_MARKER,
            is_active: true,
            created_via: "import",
            search_text: searchText,
          });
          packCandidates.push({ code, sellPrice, barcode, pack: rule.pack });
        }
      }
    }

    for (let i = 0; i < productRows.length; i += 500) {
      const chunk = productRows.slice(i, i + 500);
      await models.RetailProduct.bulkCreate(chunk);
      createdProducts += chunk.length;
    }

    const inserted = await models.RetailProduct.findAll({
      where: { code: productRows.map((r) => r.code) },
      attributes: ["product_id", "code"],
      raw: true,
    });
    const idByCode = new Map(inserted.map((r) => [r.code, r.product_id]));

    const unitRows = [];
    const barcodeRows = [];
    for (const meta of packCandidates) {
      const pid = idByCode.get(meta.code);
      if (!pid) continue;
      if (meta.pack) {
        unitRows.push({
          product_id: pid,
          unit_name: meta.pack.unit_name,
          factor: meta.pack.factor,
          sell_price: roundLkr(meta.sellPrice * meta.pack.factor * 0.95),
          is_default_sale: false,
        });
      }
      if (meta.barcode) {
        barcodeRows.push({
          barcode: meta.barcode,
          product_id: pid,
          unit_id: null,
        });
      }
    }

    for (let i = 0; i < unitRows.length; i += 500) {
      const chunk = unitRows.slice(i, i + 500);
      await models.RetailProductUnit.bulkCreate(chunk);
      createdUnits += chunk.length;
    }
    for (let i = 0; i < barcodeRows.length; i += 500) {
      const chunk = barcodeRows.slice(i, i + 500);
      await models.RetailBarcode.bulkCreate(chunk);
      createdBarcodes += chunk.length;
    }
    }

    let perfAdded = 0;
    if (withPerf) {
      const perfRows = [];
      for (let i = 0; i < 10_000; i++) {
        const sub = subCats[i % subCats.length];
        const parent = catsById.get(sub.parent_id);
        const bName = (SUBCAT_BRANDS[sub.name] || SUBCAT_BRANDS[parent?.name] || ["Lanka"])[0];
        const brand = brandByName.get(bName);
        const code = allocCode();
        const variant = `${(i % 20) + 1}mm`;
        const name = generateName({
          brand: brand.name,
          itemName: sub.item_name || sub.name,
          subCategory: sub.name,
          variant,
        });
        const searchText = buildSearchText(
          { code, name, variant_label: variant },
          { category: parent || sub, subCategory: parent ? sub : null, brand, aliases },
        );
        perfRows.push({
          code,
          name: `${name} #${i + 1}`,
          variant_label: variant,
          category_id: sub.category_id,
          brand_id: brand.brand_id,
          tracking: "counted",
          base_unit: sub.default_unit || "pcs",
          allow_decimal: false,
          sell_price: 250 + (i % 500),
          contractor_price: 225 + (i % 500),
          avg_cost: 180,
          description: DEMO_MARKER,
          is_active: true,
          created_via: "import",
          search_text: searchText,
        });
      }
      for (let i = 0; i < perfRows.length; i += 500) {
        const chunk = perfRows.slice(i, i + 500);
        await models.RetailProduct.bulkCreate(chunk);
        perfAdded += chunk.length;
      }
    }

    if (withStock) {
      const {
        postOpeningDocument,
        createReceiveDocument,
        postAdjustDocument,
        postCountDocument,
        checkStockIntegrity,
      } = await import("../src/modules/retail/stock/stockService.js");

      const adminUser = await models.User.findOne({ order: [["user_id", "ASC"]] });
      const actorId = adminUser?.user_id || 1;
      const warehouse = await models.Warehouse.findOne({ order: [["warehouse_id", "ASC"]] });
      const warehouseId = warehouse?.warehouse_id || 1;
      const stockOpts = { effectivePermissions: new Set(["*"]) };

      const allProds = await models.RetailProduct.findAll({
        where: { is_active: true, tracking: "counted" },
        include: [{ model: models.RetailProductUnit, as: "Units" }],
        order: [["product_id", "ASC"]],
      });

      const openingQtyFor = (p, idx) => {
        const u = p.base_unit;
        if (u === "m") return 90 + ((idx * 30) % 180);
        if (u === "ft") return 60 + ((idx * 20) % 160);
        if (u === "kg") return 15 + ((idx * 5) % 45);
        if (u === "tin" || u === "bag") return 10 + ((idx * 3) % 30);
        return 12 + ((idx * 7) % 108);
      };

      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      // Opening stock for ~70% of products
      const openingLines = [];
      for (let i = 0; i < allProds.length; i++) {
        if (i % 10 >= 7) continue; // leave ~30% not counted yet
        openingLines.push({
          product_id: allProds[i].product_id,
          qty: openingQtyFor(allProds[i], i),
          unit_cost: Number(allProds[i].avg_cost || 0),
        });
      }
      let openingDocs = 0;
      for (let i = 0; i < openingLines.length; i += 100) {
        await postOpeningDocument(
          models,
          actorId,
          {
            warehouse_id: warehouseId,
            occurred_at: sixtyDaysAgo.toISOString(),
            note: "Initial opening stock",
            lines: openingLines.slice(i, i + 100),
          },
          stockOpts,
        );
        openingDocs += 1;
      }

      // Group products by family for realistic multi-size supplier deliveries
      const byFamily = new Map();
      for (const p of allProds) {
        if (!p.family_id) continue;
        const arr = byFamily.get(p.family_id) || [];
        arr.push(p);
        byFamily.set(p.family_id, arr);
      }
      const familyGroups = [...byFamily.values()].filter((g) => g.length > 0);
      const SUPPLIERS = [
        "Ceylon Hardware Distributors",
        "Lanka Tool House",
        "Metro Building Supplies",
        "Kelani Electrical Agencies",
        "Kandy Paint & Coatings",
        "S-lon Authorized Dealers",
      ];

      let receivePosted = 0;
      let receiveDrafts = 0;
      for (let i = 0; i < 35; i++) {
        const fam = familyGroups[(i * 5) % familyGroups.length];
        const supplier = SUPPLIERS[i % SUPPLIERS.length];
        const daysAgo = 55 - Math.floor((i * 52) / 35);
        const occurredAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
        const isDraft = i >= 31; // 4 drafts left unposted
        const deliveryCharge = i % 4 === 0 ? 750 + (i % 3) * 500 : 0;

        const lines = fam.slice(0, 5).map((p, idx) => {
          const packUnit = (p.Units || [])[0] || null;
          const usePack = Boolean(packUnit && idx % 2 === 0);
          const factor = usePack ? Number(packUnit.factor) : 1;
          const qty = usePack ? 2 + (idx % 3) : 10 + ((i + idx) % 15);
          const baseCost = Number(p.avg_cost || Number(p.sell_price) * 0.72);
          return {
            product_id: p.product_id,
            ...(usePack ? { unit_id: packUnit.unit_id } : {}),
            qty,
            unit_cost: Math.round(baseCost * factor * 100) / 100,
          };
        });

        await createReceiveDocument(
          models,
          actorId,
          {
            warehouse_id: warehouseId,
            supplier_name: supplier,
            supplier_ref: `INV-${202600 + i}`,
            occurred_at: occurredAt.toISOString(),
            delivery_charge: deliveryCharge,
            lines,
            post: !isDraft,
          },
          stockOpts,
        );
        if (isDraft) receiveDrafts += 1;
        else receivePosted += 1;
      }

      // Handful of adjustments (damaged, lost, own_use)
      const countedProds = allProds.filter((_, idx) => idx % 10 < 7);
      const adjustReasons = ["damaged", "lost", "own_use", "damaged"];
      for (let i = 0; i < adjustReasons.length; i++) {
        const p = countedProds[(i * 17) % countedProds.length];
        await postAdjustDocument(
          models,
          actorId,
          {
            warehouse_id: warehouseId,
            reason: adjustReasons[i],
            note: `Demo ${adjustReasons[i]} adjustment`,
            occurred_at: new Date(Date.now() - (10 - i) * 24 * 60 * 60 * 1000).toISOString(),
            lines: [{ product_id: p.product_id, qty_change: -(1 + (i % 3)) }],
          },
          stockOpts,
        );
      }

      // One category count
      const countSubset = countedProds.slice(0, 8);
      await postCountDocument(
        models,
        actorId,
        {
          warehouse_id: warehouseId,
          note: "Cycle count sample",
          lines: countSubset.map((p, idx) => ({
            product_id: p.product_id,
            counted_qty: openingQtyFor(p, idx) + (idx % 2 === 0 ? 2 : -1),
          })),
        },
        stockOpts,
      );

      const integrity = await checkStockIntegrity(models);
      console.log(
        `📦 Seeded stock: opening_docs=${openingDocs} (${openingLines.length} products), receive_posted=${receivePosted}, receive_drafts=${receiveDrafts}, adjusts=${adjustReasons.length}, counts=1, integrity_ok=${integrity.ok} (checked=${integrity.checked_pairs}, mismatches=${integrity.mismatches.length})`,
      );
    }

    console.log(
      `✅ Seeded ${dbName}: families=${createdFamilies}, products=${createdProducts}, units=${createdUnits}, barcodes=${createdBarcodes}, perf_extra=${perfAdded}`,
    );
    process.exit(0);
  } catch (err) {
    console.error("Seed failed:", err.message);
    process.exit(1);
  }
})();
