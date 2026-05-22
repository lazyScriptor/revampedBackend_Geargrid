import { Op } from "sequelize";
import { writeRowsToCsv } from "./_helpers.js";
import { fileSize } from "../../utils/jobFileStore.js";

const HEADERS = [
  { key: "equipment_id", label: "ID" },
  { key: "equipment_name", label: "Equipment Name" },
  { key: "category_name", label: "Category" },
  { key: "warehouse_name", label: "Warehouse" },
  { key: "rental_price_per_day", label: "Rate / Day" },
  { key: "available_quantity", label: "Available" },
  { key: "total_quantity", label: "Total" },
  { key: "status", label: "Status" },
];

export default async function exportEquipmentCsv(ctx) {
  const { tenantDbName, models, job, reportProgress } = ctx;
  const params = job.params || {};

  const where = { equipment_delete_status: { [Op.not]: true } };
  if (params.warehouse_id) where.warehouse_id = params.warehouse_id;
  if (params.category_id) where.category_id = params.category_id;
  if (params.status) where.status = params.status;

  const total = await models.Equipment.count({ where });
  await reportProgress({ totalCount: total, processedCount: 0, progress: 5 });

  const batchSize = 500;
  const rows = [];
  let processed = 0;

  for (let offset = 0; offset < Math.max(total, 1); offset += batchSize) {
    const chunk = await models.Equipment.findAll({
      where,
      include: [
        { model: models.EquipmentCategory, attributes: ["category_name"] },
        { model: models.Warehouse, attributes: ["warehouse_name"] },
      ],
      offset,
      limit: batchSize,
      order: [["equipment_id", "ASC"]],
    });

    for (const e of chunk) {
      rows.push({
        equipment_id: e.equipment_id,
        equipment_name: e.equipment_name,
        category_name: e.EquipmentCategory?.category_name || "",
        warehouse_name: e.Warehouse?.warehouse_name || "",
        rental_price_per_day: e.rental_price_per_day,
        available_quantity: e.available_quantity,
        total_quantity: e.total_quantity,
        status: e.status,
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
