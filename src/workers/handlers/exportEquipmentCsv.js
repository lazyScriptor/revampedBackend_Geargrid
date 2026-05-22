import { writeRowsToCsv } from "./_helpers.js";
import { fileSize } from "../../utils/jobFileStore.js";

const HEADERS = [
  { key: "equipment_id", label: "ID" },
  { key: "equipment_name", label: "Equipment Name" },
  { key: "serial_number", label: "Serial #" },
  { key: "category_name", label: "Category" },
  { key: "warehouse_name", label: "Warehouse" },
  { key: "base_rental_price", label: "Rate / Day" },
  { key: "available_qty", label: "Available" },
  { key: "total_owned_qty", label: "Total" },
  { key: "rented_qty", label: "Rented" },
  { key: "defective_qty", label: "Defective" },
];

export default async function exportEquipmentCsv(ctx) {
  const { tenantDbName, models, job, reportProgress } = ctx;
  const params = job.params || {};

  const where = {};
  if (params.warehouse_id) where.warehouse_id = params.warehouse_id;
  if (params.category_id) where.category_id = params.category_id;

  const total = await models.Equipment.count({ where });
  await reportProgress({ totalCount: total, processedCount: 0, progress: 5 });

  const batchSize = 500;
  const rows = [];
  let processed = 0;

  for (let offset = 0; offset < Math.max(total, 1); offset += batchSize) {
    const chunk = await models.Equipment.findAll({
      where,
      include: [
        { model: models.EquipmentCategory, attributes: ["category_name"], required: false },
        { model: models.Warehouse, attributes: ["location_name"], required: false },
      ],
      offset,
      limit: batchSize,
      order: [["equipment_id", "ASC"]],
    });

    for (const e of chunk) {
      rows.push({
        equipment_id: e.equipment_id,
        equipment_name: e.equipment_name,
        serial_number: e.serial_number,
        category_name: e.EquipmentCategory?.category_name || "",
        warehouse_name: e.Warehouse?.location_name || "",
        base_rental_price: e.base_rental_price,
        available_qty: e.available_qty,
        total_owned_qty: e.total_owned_qty,
        rented_qty: e.rented_qty,
        defective_qty: e.defective_qty,
      });
    }
    processed += chunk.length;
    await reportProgress({
      processedCount: processed,
      progress: Math.min(95, Math.round((processed / Math.max(total, 1)) * 90) + 5),
    });
  }

  const outputFilePath = writeRowsToCsv({
    tenantDbName,
    jobId: job.job_id,
    headers: HEADERS,
    rows,
    fileName: `equipment-export-${Date.now()}.csv`,
  });

  return {
    status: "completed",
    summary: `Exported ${rows.length} equipment record(s) to CSV.`,
    outputFilePath,
    resultPayload: {
      download_url: `/api/bulk-jobs/${job.job_id}/download`,
      file_size_bytes: fileSize(outputFilePath),
      record_count: rows.length,
      format: "csv",
    },
  };
}
