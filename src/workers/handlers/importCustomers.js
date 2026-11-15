import { Op } from "sequelize";
import { streamParseCsv, countCsvRows } from "./_helpers.js";
import { syncCustomerPhones } from "../../services/customerPhoneService.js";

const norm = (k) => String(k || "").trim().toLowerCase();
const pickRow = (raw) => {
  const out = {};
  for (const key of Object.keys(raw)) {
    out[norm(key)] = raw[key] != null ? String(raw[key]).trim() : null;
  }
  return out;
};

export default async function importCustomers(ctx) {
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
        // Required fields: nic_number, phone_number, and either first/last
        // names (Individual) or company_name (Business).
        const customer_type = (r.customer_type || "Individual").trim();
        const nic = r.nic_number || r.nic || null;
        const phone = r.phone_number || r.phone || null;
        if (!nic || !phone) {
          skipped += 1;
          errors.push({
            row: processed + validRows.length + 1,
            message: "Missing nic_number or phone_number",
          });
          continue;
        }

        validRows.push({
          customer_type,
          company_name: r.company_name || null,
          first_name: r.first_name || (customer_type === "Individual" ? "" : null),
          last_name: r.last_name || (customer_type === "Individual" ? "" : null),
          nic_number: nic,
          phone_number: phone,
          address_line1: r.address_line1 || null,
          address_line2: r.address_line2 || null,
          rating: r.rating ? Number(r.rating) : 5,
          status: r.status || "Active",
        });
      }

      if (validRows.length > 0) {
        try {
          const runBatch = async (t) => {
            const opts = t ? { transaction: t } : {};
            const created = await models.Customer.bulkCreate(validRows, {
              validate: false,
              ignoreDuplicates: true,
              ...opts,
            });
            inserted += validRows.length;

            if (models.CustomerPhone) {
              const byId = new Map();
              for (const c of created || []) {
                if (c?.customer_id) byId.set(c.customer_id, c);
              }
              const nics = validRows.map((r) => r.nic_number).filter(Boolean);
              if (byId.size === 0 && nics.length > 0) {
                const fetched = await models.Customer.findAll({
                  where: { nic_number: { [Op.in]: nics } },
                  attributes: ["customer_id", "phone_number", "customer_delete_status"],
                  ...opts,
                });
                for (const c of fetched) byId.set(c.customer_id, c);
              }
              for (const cust of byId.values()) {
                await syncCustomerPhones(models, cust, opts);
              }
            }
          };

          if (models.sequelize?.transaction) {
            await models.sequelize.transaction(runBatch);
          } else {
            await runBatch(undefined);
          }
        } catch (err) {
          for (const row of validRows) {
            try {
              const runSingle = async (t) => {
                const opts = t ? { transaction: t } : {};
                const created = await models.Customer.create(row, opts);
                await syncCustomerPhones(models, created, opts);
              };
              if (models.sequelize?.transaction) {
                await models.sequelize.transaction(runSingle);
              } else {
                await runSingle(undefined);
              }
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
    summary: `Imported ${inserted}/${processed} customer row(s). ${skipped} skipped.`,
    resultPayload: {
      inserted,
      skipped,
      total: processed,
      errors_sample: errors.slice(0, 50),
    },
  };
}
