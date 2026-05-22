import { streamParseCsv, countCsvRows } from "./_helpers.js";

// CSV headers expected (case-insensitive normalized):
//   equipment_name, category_id, warehouse_id, rental_price_per_day,
//   available_quantity, total_quantity, status
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

  // Pre-count for nicer progress UX.
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
        if (!name) {
          skipped += 1;
          errors.push({ row: processed + validRows.length + 1, message: "Missing equipment_name" });
          continue;
        }
        validRows.push({
          equipment_name: name,
          category_id: toInt(r.category_id),
          warehouse_id: toInt(r.warehouse_id),
          rental_price_per_day: toNum(r.rental_price_per_day) ?? 0,
          available_quantity: toInt(r.available_quantity) ?? 0,
          total_quantity: toInt(r.total_quantity) ?? 0,
          status: r.status || "Active",
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
