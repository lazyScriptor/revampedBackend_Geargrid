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

export const importEquipment = async (models, fileBuffer) => {
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    let rowNumber = 1;

    // 1. Convert Buffer to String
    let csvString = fileBuffer.toString("utf-8");

    // 2. ENTERPRISE FIX: Hardware tools often use " for inches (e.g. 4.5").
    // Standard CSV parsers crash because they think it's an unclosed string.
    // We safely replace quotes preceded by a number and followed by a comma with 'inch'.
    csvString = csvString.replace(/(\d)"(,|s|$)/g, "$1 inch$2");

    // 3. CRITICAL FIX: Wrap in an array so Node streams the whole chunk correctly
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
        try {
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
              data.is_bulk_item &&
              data.is_bulk_item.trim().toLowerCase() === "true",
            warranty_period_months: data.warranty_period_months
              ? parseInt(data.warranty_period_months, 10)
              : null,
            end_of_warranty_date: data.end_of_warranty_date?.trim() || null,
            image_url: data.image_url?.trim() || null,
          };

          // Auto-calculate logic
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
