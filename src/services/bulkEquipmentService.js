import { Readable } from "stream";
import csvParser from "csv-parser";
import { Parser } from "json2csv";

// The exact headers required for the CSV
const CSV_FIELDS = [
  "serial_number", // Using this as our unique identifier for Upserts
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
  // Pass an empty array to just get the headers
  return json2csvParser.parse([]);
};

export const exportEquipment = async (models) => {
  const equipment = await models.Equipment.findAll({
    raw: true,
    attributes: CSV_FIELDS, // Only grab the fields we want to export
  });

  if (!equipment || equipment.length === 0) {
    const json2csvParser = new Parser({ fields: CSV_FIELDS });
    return json2csvParser.parse([]);
  }

  const json2csvParser = new Parser({ fields: CSV_FIELDS });
  return json2csvParser.parse(equipment);
};

export const importEquipment = async (models, fileBuffer) => {
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    let rowNumber = 1;

    // Convert the buffer stored in memory into a readable stream
    const stream = Readable.from(fileBuffer);

    stream
      .pipe(csvParser())
      .on("data", (data) => {
        rowNumber++;
        try {
          // 1. Basic Validation
          if (
            !data.serial_number ||
            !data.equipment_name ||
            !data.category_id ||
            !data.warehouse_id
          ) {
            throw new Error(
              `Missing required fields (serial_number, equipment_name, category_id, or warehouse_id)`,
            );
          }

          // 2. Clean Data Types
          const cleanRow = {
            serial_number: data.serial_number.trim(),
            equipment_name: data.equipment_name.trim(),
            category_id: parseInt(data.category_id, 10),
            warehouse_id: parseInt(data.warehouse_id, 10),
            base_rental_price: parseFloat(data.base_rental_price) || 0,
            extra_daily_rate: data.extra_daily_rate
              ? parseFloat(data.extra_daily_rate)
              : null,
            minimum_rental_days: parseInt(data.minimum_rental_days, 10) || 1,
            purchase_cost: data.purchase_cost
              ? parseFloat(data.purchase_cost)
              : null,
            total_owned_qty: parseInt(data.total_owned_qty, 10) || 1,
            is_bulk_item:
              data.is_bulk_item && data.is_bulk_item.toLowerCase() === "true",
            warranty_period_months: data.warranty_period_months
              ? parseInt(data.warranty_period_months, 10)
              : null,
            end_of_warranty_date: data.end_of_warranty_date || null,
            image_url: data.image_url || null,
          };

          // Automatically set available_qty to total_owned_qty for new items
          cleanRow.available_qty = cleanRow.total_owned_qty;
          cleanRow.rented_qty = 0;

          results.push(cleanRow);
        } catch (err) {
          errors.push({ row: rowNumber, message: err.message });
        }
      })
      .on("end", async () => {
        try {
          if (results.length > 0) {
            // Enterprise Upsert: If the serial_number already exists, update these specific fields instead of crashing!
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
          }
          resolve({ successCount: results.length, errors });
        } catch (dbError) {
          reject(dbError);
        }
      })
      .on("error", (error) => reject(error));
  });
};
