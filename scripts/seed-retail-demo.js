import dotenv from "dotenv";

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

if (!dbName) {
  console.error("Usage: NODE_ENV=development node scripts/seed-retail-demo.js <db_name> [--perf]");
  process.exit(1);
}

const BRAND_NAMES = [
  "SALI",
  "Tolsen",
  "Ingco",
  "Bosch",
  "Makita",
  "Lanka Wall Tiles",
  "S-lon",
  "Anton",
  "Kelani Cables",
  "Dulux",
  "Nippon",
];

const PACK_TEMPLATES = [
  { match: /nail|screw|bolt|anchor|plug|hinge/i, unit_name: "box", factor: 100 },
  { match: /wire|cable|hose/i, unit_name: "coil", factor: 90 },
  { match: /pipe|conduit|steel bar/i, unit_name: "length", factor: 20 },
  { match: /emulsion|enamel|primer|thinner/i, unit_name: "tin", factor: 4 },
];

(async () => {
  try {
    const { masterSequelize, getTenantConnection } = await import("../src/config/database.js");
    const { initMasterModels } = await import("../src/models/master/index.js");
    const { initTenantModels } = await import("../src/models/index.js");
    const { ensureStarterCatalog } = await import("../src/modules/retail/catalog/starterService.js");
    const { buildSearchText, generateName } = await import("../src/modules/retail/catalog/naming.js");

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

    // Ensure brands exist
    const brands = [];
    for (const bName of BRAND_NAMES) {
      const [b] = await models.RetailBrand.findOrCreate({
        where: { name: bName },
        defaults: { name: bName, is_active: true },
      });
      brands.push(b);
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

    const existingFamiliesCount = await models.RetailFamily.count();
    let createdFamilies = 0;
    let createdProducts = 0;
    let createdUnits = 0;
    let createdBarcodes = 0;

    if (existingFamiliesCount === 0) {
      const productRows = [];
      const packCandidates = [];

      // Target ~300 families across sub-categories (~5 variants each = ~1,500 products)
      let familySeq = 0;
      while (createdFamilies < 300) {
        const sub = subCats[familySeq % subCats.length];
        const parent = catsById.get(sub.parent_id);
        const brand = brands[(familySeq + Math.floor(familySeq / subCats.length)) % brands.length];
        const seriesTag = familySeq >= subCats.length * brands.length ? ` Pro-${Math.floor(familySeq / (subCats.length * brands.length))}` : "";
        familySeq += 1;

        const sizes =
          Array.isArray(sub.usual_sizes) && sub.usual_sizes.length > 0
            ? sub.usual_sizes.slice(0, 5)
            : ["Std", "Heavy", "Light", "Pro", "Eco"];

        const familyName = `${brand.name} ${sub.name}${seriesTag}`.trim();
        const family = await models.RetailFamily.create({
          name: familyName,
          name_si: sub.name_si ? `${brand.name} ${sub.name_si}${seriesTag}` : null,
          category_id: sub.category_id,
          brand_id: brand.brand_id,
          option_label: "Size",
          option_unit: null,
        });
        createdFamilies += 1;

        const baseUnit = sub.default_unit || parent?.default_unit || "pcs";
        const allowDecimal = ["kg", "g", "m", "ft", "L"].includes(baseUnit);

        for (let idx = 0; idx < sizes.length; idx++) {
          const variant = String(sizes[idx]);
          const code = allocCode();
          const sellPrice = Math.round((120 + ((familySeq * 37 + idx * 85) % 4800)) / 10) * 10;
          const contractorPrice = Math.round((sellPrice * 0.9) / 10) * 10;
          const avgCost = Math.round((sellPrice * 0.72) * 100) / 100;
          const name = generateName({
            brand: brand.name,
            category: parent?.name || "",
            subCategory: sub.name,
            itemWord: seriesTag.trim(),
            variant,
            unit: "",
          });

          const barcode = idx % 2 === 0 ? `890${String(maxCodeNum).padStart(10, "0")}` : null;
          const packTpl = PACK_TEMPLATES.find((t) => t.match.test(sub.name));

          const searchText = buildSearchText(
            { code, name, variant_label: variant },
            {
              category: parent || sub,
              subCategory: parent ? sub : null,
              family,
              brand,
              units: packTpl ? [packTpl.unit_name] : [],
              barcodes: barcode ? [barcode] : [],
              aliases,
            },
          );

          productRows.push({
            code,
            name,
            family_id: family.family_id,
            variant_label: variant,
            category_id: sub.category_id,
            brand_id: brand.brand_id,
            tracking: "counted",
            base_unit: baseUnit,
            allow_decimal: allowDecimal,
            sell_price: sellPrice,
            contractor_price: contractorPrice,
            avg_cost: avgCost,
            last_cost: avgCost,
            reorder_level: 10,
            is_active: true,
            created_via: "catalog",
            search_text: searchText,
          });
          packCandidates.push({ code, sellPrice, barcode, packTpl });
        }
      }

      // Bulk insert products in chunks of 500
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
        if (meta.packTpl) {
          unitRows.push({
            product_id: pid,
            unit_name: meta.packTpl.unit_name,
            factor: meta.packTpl.factor,
            sell_price: Math.round(meta.sellPrice * meta.packTpl.factor * 0.95),
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
        const brand = brands[i % brands.length];
        const code = allocCode();
        const variant = `${(i % 20) + 1}mm`;
        const name = `${brand.name} ${sub.name} Item-${i + 1} ${variant}`;
        const searchText = buildSearchText(
          { code, name, variant_label: variant },
          { category: parent || sub, subCategory: parent ? sub : null, brand, aliases },
        );
        perfRows.push({
          code,
          name,
          variant_label: variant,
          category_id: sub.category_id,
          brand_id: brand.brand_id,
          tracking: "counted",
          base_unit: sub.default_unit || "pcs",
          allow_decimal: false,
          sell_price: 250 + (i % 500),
          contractor_price: 225 + (i % 500),
          avg_cost: 180,
          is_active: true,
          created_via: "catalog",
          search_text: searchText,
        });
      }
      for (let i = 0; i < perfRows.length; i += 500) {
        const chunk = perfRows.slice(i, i + 500);
        await models.RetailProduct.bulkCreate(chunk);
        perfAdded += chunk.length;
      }
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
