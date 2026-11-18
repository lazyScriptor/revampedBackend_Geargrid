import ExcelJS from "exceljs";
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

export const generateExcelTemplate = async (models) => {
  const [cats, whs] = await Promise.all([
    models.EquipmentCategory.findAll({ attributes: ["category_name"], order: [["category_name", "ASC"]], raw: true }),
    models.Warehouse.findAll({ attributes: ["location_name"], order: [["location_name", "ASC"]], raw: true }),
  ]);

  const categories = cats.map((c) => c.category_name).filter(Boolean);
  const warehouses = whs.map((w) => w.location_name).filter(Boolean);
  const multiWarehouse = warehouses.length > 1;

  const cols = [
    { header: "Name", required: true, width: 28, format: "Text (min 2 chars)", note: "Required. Example: Hilti Breaker - 1" },
    { header: "Name (Sinhala)", required: false, width: 24, format: "Text", note: "Optional Sinhala display name" },
    { header: "EQ No.", required: false, width: 14, format: "Text (e.g. EQ-101)", note: "Optional. Leave blank to assign the next EQ number automatically" },
    { header: "Category", required: true, width: 22, format: "Category name", note: "Required (unless you pick one category for all rows in step 2)" },
    { header: "Location", required: multiWarehouse, width: 22, format: "Location name", note: multiWarehouse ? "Required (shop has multiple locations)" : "Optional when shop has a single location" },
    { header: "Base price", required: true, width: 14, format: "Number >= 0", note: "Required. Daily rental rate" },
    { header: "Extra/day", required: false, width: 14, format: "Number >= 0", note: "Optional. Defaults to Base price if blank" },
    { header: "Min days", required: false, width: 12, format: "Whole number >= 1", note: "Optional. Defaults to 1" },
    { header: "Qty", required: false, width: 10, format: "yes / no", note: "Optional bulk item flag. Defaults to no (automatically yes if Total > 1)" },
    { header: "Total", required: false, width: 10, format: "Whole number >= 1", note: "Optional total owned units. Defaults to 1" },
    { header: "Cost", required: false, width: 14, format: "Number >= 0", note: "Optional purchase cost" },
    { header: "Warr. mo", required: false, width: 12, format: "Whole number >= 0", note: "Optional warranty duration in months" },
    { header: "Warranty end", required: false, width: 16, format: "YYYY-MM-DD", note: "Optional warranty end date" },
  ];

  const wb = new ExcelJS.Workbook();
  wb.creator = "GearGrid";

  // Sheet 1: Equipment
  const eqSheet = wb.addWorksheet("Equipment");
  eqSheet.columns = cols.map((c) => ({ header: c.header, width: c.width }));
  const headerRow = eqSheet.getRow(1);
  cols.forEach((c, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.font = { bold: true, color: { argb: c.required ? "FF991B1B" : "FF0F172A" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: c.required ? "FFFEE2E2" : "FFF1F5F9" },
    };
  });

  const exampleRow = eqSheet.addRow([
    "Hilti Breaker - 1",
    "",
    "",
    categories[0] || "Power Tools",
    warehouses[0] || "Main Warehouse",
    1500,
    1500,
    1,
    "no",
    1,
    85000,
    12,
    "2027-12-31",
  ]);
  exampleRow.eachCell((cell) => {
    cell.font = { italic: true, color: { argb: "FF64748B" } };
  });

  // Sheet 2: Lists (for dropdown validation)
  const listsSheet = wb.addWorksheet("Lists");
  listsSheet.columns = [
    { header: "Categories", width: 28 },
    { header: "Locations", width: 28 },
  ];
  const maxListLen = Math.max(categories.length, warehouses.length);
  for (let i = 0; i < maxListLen; i++) {
    listsSheet.addRow([categories[i] || "", warehouses[i] || ""]);
  }

  if (categories.length > 0) {
    const catRange = `Lists!$A$2:$A$${categories.length + 1}`;
    for (let r = 3; r <= 200; r++) {
      eqSheet.getCell(r, 4).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [catRange],
      };
    }
  }
  if (warehouses.length > 0) {
    const whRange = `Lists!$B$2:$B$${warehouses.length + 1}`;
    for (let r = 3; r <= 200; r++) {
      eqSheet.getCell(r, 5).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [whRange],
      };
    }
  }

  // Sheet 3: How to fill
  const guideSheet = wb.addWorksheet("How to fill");
  guideSheet.columns = [
    { header: "Column", width: 20 },
    { header: "Required?", width: 22 },
    { header: "Format", width: 22 },
    { header: "Notes", width: 55 },
  ];
  guideSheet.getRow(1).font = { bold: true };
  for (const c of cols) {
    guideSheet.addRow([c.header, c.required ? "Required" : "Optional", c.format, c.note]);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

export const exportEquipment = async (models) => {
  const equipment = await models.Equipment.findAll({
    where: { is_archived: false },
    raw: true,
    attributes: CSV_FIELDS,
  });
  if (!equipment || equipment.length === 0) return generateTemplate();
  const json2csvParser = new Parser({ fields: CSV_FIELDS });
  return json2csvParser.parse(equipment);
};
