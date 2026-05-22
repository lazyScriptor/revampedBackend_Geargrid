import { streamParseCsv, countCsvRows } from "./_helpers.js";

// Accepted CSV headers (case-insensitive):
//   equipment_name (required)
//   serial_number
//   category_id, warehouse_id (required)
//   base_rental_price (or "rental_price_per_day" as a friendly alias)
//   extra_daily_rate (defaults to base_rental_price if missing)
//   available_qty (or "available_quantity")
//   total_owned_qty (or "total_quantity")
//   rented_qty, defective_qty, minimum_rental_days
const norm = (k) => String(k || "").trim().toLowerCase();
const pickRow = (raw) => {
  const out = {};
  for (const key of Object.keys(raw)) {
    out[norm(key)] = raw[key] != null ? String(raw[key]).trim() : null;
  }
  return out;
};

const toInt = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const toNum = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export default async function importEquipment(ctx) {
  const { models, job, reportProgress } = ctx;
  const inputPath = job.input_file_path;
  if (!inputPath) throw new Error("Import job has no input_file_path");

  const total = await countCsvRows(inputPath);
  await reportProgress({ totalCount: total, processedCount: 0, progress: 3 });

  const errors = [];
  let processed = 0;
  let inserted = 0;
  let skipped = 0;

  await streamParseCsv(inputPath, {
    batchSize: 500,
    onBatch: async (rawRows) => {
      const validRows = [];
      for (const raw of rawRows) {
        const r = pickRow(raw);
        const name = r.equipment_name;
        const categoryId = toInt(r.category_id);
        const warehouseId = toInt(r.warehouse_id);

        if (!name || categoryId == null || warehouseId == null) {
          skipped += 1;
          errors.push({
            row: processed + validRows.length + 1,
            message: "Missing equipment_name, category_id, or warehouse_id",
          });
          continue;
        }

        const base = toNum(r.base_rental_price) ?? toNum(r.rental_price_per_day) ?? 0;
        const extra = toNum(r.extra_daily_rate) ?? base;
        const totalOwned =
          toInt(r.total_owned_qty) ?? toInt(r.total_quantity) ?? 1;
        const available =
          toInt(r.available_qty) ?? toInt(r.available_quantity) ?? totalOwned;

        validRows.push({
          equipment_name: name,
          serial_number: r.serial_number || null,
          category_id: categoryId,
          warehouse_id: warehouseId,
          base_rental_price: base,
          extra_daily_rate: extra,
          total_owned_qty: totalOwned,
          available_qty: available,
          rented_qty: toInt(r.rented_qty) ?? 0,
          defective_qty: toInt(r.defective_qty) ?? 0,
          minimum_rental_days: toInt(r.minimum_rental_days) ?? 1,
        });
      }

      if (validRows.length > 0) {
        try {
          await models.Equipment.bulkCreate(validRows, { validate: false });
          inserted += validRows.length;
        } catch (err) {
          // Fall back to row-by-row to recover from a single bad row.
          for (const row of validRows) {
            try {
              await models.Equipment.create(row);
              inserted += 1;
            } catch (innerErr) {
              skipped += 1;
              errors.push({
                row: processed + validRows.indexOf(row) + 1,
                message: innerErr.message?.slice(0, 200) || "Insert failed",
              });
            }
          }
        }
      }

      processed += rawRows.length;
      const progress = total > 0 ? Math.min(95, Math.round((processed / total) * 90) + 3) : 50;
      await reportProgress({
        processedCount: processed,
        errorCount: skipped,
        progress,
      });
    },
  });

  return {
    status: "completed",
    summary: `Imported ${inserted}/${processed} equipment row(s). ${skipped} skipped.`,
    resultPayload: {
      inserted,
      skipped,
      total: processed,
      errors_sample: errors.slice(0, 50),
    },
  };
}
