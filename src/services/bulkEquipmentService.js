import { Readable } from "stream";
import csvParser from "csv-parser";
import { Parser } from "json2csv";

const CSV_FIELDS = [
  "serial_number",
  "equipment_name",
  "category_id",
  "warehouse_id",
  "base_rental_price",
  "extra_daily_rate",
  "minimum_rental_days",
  "purchase_cost",
  "total_owned_qty",
  "is_bulk_item",
  "warranty_period_months",
  "end_of_warranty_date",
  "image_url",
];

export const generateTemplate = () => {
  const json2csvParser = new Parser({ fields: CSV_FIELDS });
  return json2csvParser.parse([]);
};

export const exportEquipment = async (models) => {
  const equipment = await models.Equipment.findAll({
    raw: true,
    attributes: CSV_FIELDS,
  });
  if (!equipment || equipment.length === 0) return generateTemplate();
  const json2csvParser = new Parser({ fields: CSV_FIELDS });
  return json2csvParser.parse(equipment);
};

// Clean key helper: strips spaces, dashes, slashes, hashes and lowercases
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

export const importEquipment = async (models, fileBuffer) => {
  // 1. Preload categories & warehouses
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

  return new Promise((resolve, reject) => {
    const rawItems = [];
    let rowNumber = 1;

    // 1. Convert Buffer to String
    let csvString = fileBuffer.toString("utf-8");

    // 2. Hardware tools quote replacement for inches (e.g. 4.5")
    csvString = csvString.replace(/(\d)"(,|s|$)/g, "$1 inch$2");

    const stream = Readable.from([csvString]);

    stream
      .pipe(
        csvParser({
          mapHeaders: ({ header }) =>
            header.trim().replace(/^[\u200B\uFEFF]/, ""), // Strip Excel BOM
        }),
      )
      .on("data", (data) => {
        rowNumber++;
        rawItems.push({ rowNumber, data });
      })
      .on("end", async () => {
        const results = [];
        const errors = [];

        for (const item of rawItems) {
          const { rowNumber: rowNum, data } = item;
          try {
            const name = getField(data, [
              "equipment_name",
              "equipment",
              "name",
              "item_name",
              "item",
              "title",
            ]);

            if (!name) {
              throw new Error("Missing equipment_name");
            }

            // Resolve Category
            let categoryId = null;
            const rawCategory = getField(data, [
              "category_id",
              "category_name",
              "category",
            ]);

            if (rawCategory) {
              const cleanCat = rawCategory.toLowerCase().trim();
              if (categoryMap.has(cleanCat)) {
                categoryId = categoryMap.get(cleanCat);
              } else {
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

            // Resolve Warehouse
            let warehouseId = null;
            const rawWarehouse = getField(data, [
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

            let serialNumber = getField(data, [
              "serial_number",
              "serial",
              "serial_no",
              "serial_#",
              "sku",
            ]);
            if (!serialNumber) {
              serialNumber = `SKU-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
            }

            const base =
              parseFloat(
                getField(data, [
                  "base_rental_price",
                  "rental_price_per_day",
                  "rate_per_day",
                  "daily_rate",
                  "rate",
                  "price",
                ]),
              ) || 0;

            const extra =
              parseFloat(
                getField(data, [
                  "extra_daily_rate",
                  "extra_rate",
                  "extra_price",
                  "extra",
                ]),
              ) || base;

            const totalOwned =
              parseInt(
                getField(data, [
                  "total_owned_qty",
                  "total_quantity",
                  "total",
                  "quantity",
                  "qty",
                ]),
                10,
              ) || 1;

            const rawAvail = getField(data, [
              "available_qty",
              "available_quantity",
              "available",
            ]);
            const available =
              rawAvail != null ? parseInt(rawAvail, 10) : totalOwned;

            const minDays =
              parseInt(
                getField(data, [
                  "minimum_rental_days",
                  "min_rental_days",
                  "min_days",
                ]),
                10,
              ) || 1;

            const purchaseCost =
              parseFloat(getField(data, ["purchase_cost", "cost"])) || null;

            const isBulkRaw = getField(data, [
              "is_bulk_item",
              "bulk_item",
              "bulk",
            ]);
            const isBulkItem =
              isBulkRaw != null &&
              (isBulkRaw.toLowerCase() === "true" ||
                isBulkRaw === "1" ||
                isBulkRaw.toLowerCase() === "yes");

            const warrantyMonths =
              parseInt(
                getField(data, [
                  "warranty_period_months",
                  "warranty_months",
                  "warranty",
                ]),
                10,
              ) || null;

            const endOfWarranty = getField(data, [
              "end_of_warranty_date",
              "warranty_date",
              "warranty_end",
            ]);

            const imageUrl = getField(data, ["image_url", "image"]);

            results.push({
              serial_number: serialNumber,
              equipment_name: name,
              category_id: categoryId,
              warehouse_id: warehouseId,
              base_rental_price: base,
              extra_daily_rate: extra,
              minimum_rental_days: minDays,
              purchase_cost: purchaseCost,
              total_owned_qty: totalOwned,
              available_qty: available,
              rented_qty: 0,
              defective_qty: 0,
              is_bulk_item: isBulkItem,
              warranty_period_months: warrantyMonths,
              end_of_warranty_date: endOfWarranty || null,
              image_url: imageUrl || null,
            });
          } catch (err) {
            errors.push({ row: rowNum, message: err.message });
          }
        }

        try {
          let insertedCount = 0;
          if (results.length > 0) {
            try {
              await models.Equipment.bulkCreate(results, {
                updateOnDuplicate: [
                  "equipment_name",
                  "category_id",
                  "warehouse_id",
                  "base_rental_price",
                  "extra_daily_rate",
                  "minimum_rental_days",
                  "purchase_cost",
                  "total_owned_qty",
                  "is_bulk_item",
                  "warranty_period_months",
                  "end_of_warranty_date",
                  "image_url",
                ],
              });
              insertedCount = results.length;
            } catch (bulkErr) {
              // Row-by-row fallback
              for (const row of results) {
                try {
                  await models.Equipment.create(row);
                  insertedCount += 1;
                } catch (singleErr) {
                  errors.push({
                    row: row.equipment_name,
                    message: singleErr.message?.slice(0, 200) || "Insert error",
                  });
                }
              }
            }
          }
          resolve({ successCount: insertedCount, errors });
        } catch (dbError) {
          reject(dbError);
        }
      })
      .on("error", (error) => reject(error));
  });
};
