import { streamParseCsv, countCsvRows } from "./_helpers.js";

// Clean key for resilient header matching: removes all non-alphanumeric chars and lowercases
const cleanKey = (k) => String(k || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const getField = (row, candidates) => {
  for (const cand of candidates) {
    const cleanCand = cleanKey(cand);
    for (const key of Object.keys(row)) {
      if (cleanKey(key) === cleanCand) {
        const val = row[key];
        if (val != null && String(val).trim() !== "") {
          return String(val).trim();
        }
      }
    }
  }
  return null;
};

export default async function importEquipment(ctx) {
  const { models, job, reportProgress } = ctx;
  const inputPath = job.input_file_path;
  if (!inputPath) throw new Error("Import job has no input_file_path");

  const total = await countCsvRows(inputPath);
  await reportProgress({ totalCount: total, processedCount: 0, progress: 3 });

  // 1. Preload / cache categories to resolve by ID or Name
  const categoryMap = new Map();
  try {
    const existingCats = await models.EquipmentCategory.findAll();
    for (const cat of existingCats) {
      categoryMap.set(String(cat.category_id), cat.category_id);
      categoryMap.set(cat.category_name.toLowerCase().trim(), cat.category_id);
    }
  } catch (e) {
    console.error("Error preloading categories:", e);
  }

  // 2. Preload / cache warehouses to resolve by ID or Name
  const warehouseMap = new Map();
  let defaultWarehouseId = null;
  try {
    const existingWhs = await models.Warehouse.findAll();
    for (const wh of existingWhs) {
      warehouseMap.set(String(wh.warehouse_id), wh.warehouse_id);
      warehouseMap.set(wh.location_name.toLowerCase().trim(), wh.warehouse_id);
    }
    if (existingWhs.length > 0) {
      defaultWarehouseId = existingWhs[0].warehouse_id;
    } else {
      const defaultWh = await models.Warehouse.create({ location_name: "Main Warehouse" });
      defaultWarehouseId = defaultWh.warehouse_id;
      warehouseMap.set("main warehouse", defaultWarehouseId);
      warehouseMap.set(String(defaultWarehouseId), defaultWarehouseId);
    }
  } catch (e) {
    console.error("Error preloading warehouses:", e);
  }

  const errors = [];
  let processed = 0;
  let inserted = 0;
  let skipped = 0;

  await streamParseCsv(inputPath, {
    batchSize: 500,
    onBatch: async (rawRows) => {
      const validRows = [];
      for (const raw of rawRows) {
        processed += 1;
        const rowNum = processed;

        // Resolve Equipment Name
        const name = getField(raw, [
          "equipment_name",
          "equipment",
          "name",
          "item_name",
          "item",
          "title",
        ]);

        if (!name) {
          skipped += 1;
          errors.push({
            row: rowNum,
            message: "Missing equipment name (required)",
          });
          continue;
        }

        // Resolve Category (by ID or by name)
        let categoryId = null;
        const rawCategory = getField(raw, [
          "category_id",
          "category_name",
          "category",
        ]);

        if (rawCategory) {
          const cleanCat = rawCategory.toLowerCase().trim();
          if (categoryMap.has(cleanCat)) {
            categoryId = categoryMap.get(cleanCat);
          } else {
            // Auto-create category in tenant DB
            try {
              const newCat = await models.EquipmentCategory.create({
                category_name: rawCategory,
                description: `Imported category ${rawCategory}`,
              });
              categoryId = newCat.category_id;
              categoryMap.set(cleanCat, categoryId);
              categoryMap.set(String(categoryId), categoryId);
            } catch (err) {
              const found = await models.EquipmentCategory.findOne({
                where: { category_name: rawCategory },
              });
              if (found) {
                categoryId = found.category_id;
                categoryMap.set(cleanCat, categoryId);
              }
            }
          }
        }

        if (!categoryId) {
          // Fallback to "General" category
          if (categoryMap.has("general")) {
            categoryId = categoryMap.get("general");
          } else {
            try {
              const genCat = await models.EquipmentCategory.create({
                category_name: "General",
                description: "Default category",
              });
              categoryId = genCat.category_id;
              categoryMap.set("general", categoryId);
              categoryMap.set(String(categoryId), categoryId);
            } catch (e) {
              const firstCat = await models.EquipmentCategory.findOne();
              categoryId = firstCat ? firstCat.category_id : null;
            }
          }
        }

        // Resolve Warehouse (by ID or by location name)
        let warehouseId = null;
        const rawWarehouse = getField(raw, [
          "warehouse_id",
          "warehouse_name",
          "warehouse",
          "location",
          "depot",
        ]);

        if (rawWarehouse) {
          const cleanWh = rawWarehouse.toLowerCase().trim();
          if (warehouseMap.has(cleanWh)) {
            warehouseId = warehouseMap.get(cleanWh);
          } else {
            // Auto-create warehouse in tenant DB
            try {
              const newWh = await models.Warehouse.create({
                location_name: rawWarehouse,
              });
              warehouseId = newWh.warehouse_id;
              warehouseMap.set(cleanWh, warehouseId);
              warehouseMap.set(String(warehouseId), warehouseId);
            } catch (err) {
              const found = await models.Warehouse.findOne({
                where: { location_name: rawWarehouse },
              });
              if (found) {
                warehouseId = found.warehouse_id;
                warehouseMap.set(cleanWh, warehouseId);
              }
            }
          }
        }

        if (!warehouseId) {
          warehouseId = defaultWarehouseId;
        }

        // Serial Number (auto-generate if omitted)
        let serialNumber = getField(raw, [
          "serial_number",
          "serial",
          "serial_no",
          "serial_#",
          "sku",
        ]);
        if (!serialNumber) {
          serialNumber = `SKU-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
        }

        // Numeric fields
        const base =
          parseFloat(
            getField(raw, [
              "base_rental_price",
              "rental_price_per_day",
              "rate_per_day",
              "rate_day",
              "rate/day",
              "rateday",
              "daily_rate",
              "day_rate",
              "rate",
              "price",
            ]),
          ) || 0;

        const extra =
          parseFloat(
            getField(raw, [
              "extra_daily_rate",
              "extra_rate",
              "extra_price",
              "extra",
            ]),
          ) || base;

        const totalOwned =
          parseInt(
            getField(raw, [
              "total_owned_qty",
              "total_quantity",
              "total",
              "quantity",
              "qty",
            ]),
            10,
          ) || 1;

        const rawAvail = getField(raw, [
          "available_qty",
          "available_quantity",
          "available",
        ]);
        const available = rawAvail != null ? parseInt(rawAvail, 10) : totalOwned;

        const rentedQty =
          parseInt(getField(raw, ["rented_qty", "rented"]), 10) || 0;
        const defectiveQty =
          parseInt(getField(raw, ["defective_qty", "defective"]), 10) || 0;
        const minDays =
          parseInt(
            getField(raw, [
              "minimum_rental_days",
              "min_rental_days",
              "min_days",
            ]),
            10,
          ) || 1;

        const purchaseCost =
          parseFloat(getField(raw, ["purchase_cost", "cost"])) || null;

        const isBulkRaw = getField(raw, [
          "is_bulk_item",
          "bulk_item",
          "bulk",
        ]);
        const isBulkItem =
          isBulkRaw != null
            ? (isBulkRaw.toLowerCase() === "true" ||
                isBulkRaw === "1" ||
                isBulkRaw.toLowerCase() === "yes")
            : (rawCategory && rawCategory.toLowerCase().includes("bulk")) || totalOwned > 1;

        const warrantyMonths =
          parseInt(
            getField(raw, [
              "warranty_period_months",
              "warranty_months",
              "warranty",
            ]),
            10,
          ) || null;

        const endOfWarranty = getField(raw, [
          "end_of_warranty_date",
          "warranty_date",
          "warranty_end",
        ]);

        const imageUrl = getField(raw, ["image_url", "image"]);

        validRows.push({
          equipment_name: name,
          serial_number: serialNumber,
          category_id: categoryId,
          warehouse_id: warehouseId,
          base_rental_price: base,
          extra_daily_rate: extra,
          total_owned_qty: totalOwned,
          available_qty: available,
          rented_qty: rentedQty,
          defective_qty: defectiveQty,
          minimum_rental_days: minDays,
          purchase_cost: purchaseCost,
          is_bulk_item: isBulkItem,
          warranty_period_months: warrantyMonths,
          end_of_warranty_date: endOfWarranty || null,
          image_url: imageUrl || null,
        });
      }

      if (validRows.length > 0) {
        try {
          await models.Equipment.bulkCreate(validRows, { validate: false });
          inserted += validRows.length;
        } catch (err) {
          // Fall back to row-by-row to recover from a single bad row
          for (const row of validRows) {
            try {
              await models.Equipment.create(row);
              inserted += 1;
            } catch (innerErr) {
              skipped += 1;
              errors.push({
                row: row.equipment_name,
                message: innerErr.message?.slice(0, 200) || "Insert failed",
              });
            }
          }
        }
      }

      const progress = total > 0 ? Math.min(95, Math.round((processed / total) * 90) + 3) : 50;
      await reportProgress({
        processedCount: processed,
        errorCount: skipped,
        progress,
      });
    },
  });

  const finalStatus = inserted > 0 ? "completed" : processed === 0 ? "completed" : "failed";
  const summary =
    inserted > 0
      ? `Imported ${inserted}/${processed} equipment row(s).${skipped > 0 ? ` ${skipped} skipped.` : ""}`
      : `Import failed: 0 of ${processed} equipment rows could be imported. Please verify your CSV headers.`;

  return {
    status: finalStatus,
    summary,
    resultPayload: {
      inserted,
      skipped,
      total: processed,
      errors_sample: errors.slice(0, 50),
    },
  };
}
