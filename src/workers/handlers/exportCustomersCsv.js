import { Op } from "sequelize";
import { writeRowsToCsv } from "./_helpers.js";
import { fileSize } from "../../utils/jobFileStore.js";

const HEADERS = [
  { key: "customer_id", label: "ID" },
  { key: "customer_type", label: "Type" },
  { key: "display_name", label: "Name" },
  { key: "nic_number", label: "NIC / Passport" },
  { key: "phone_number", label: "Phone" },
  { key: "address_line1", label: "Address" },
  { key: "rating", label: "Rating" },
  { key: "deposit_balance", label: "Deposit Balance" },
  { key: "status", label: "Status" },
];

export default async function exportCustomersCsv(ctx) {
  const { tenantDbName, models, job, reportProgress } = ctx;
  const params = job.params || {};

  const where = { customer_delete_status: { [Op.not]: true } };
  if (params.status) where.status = params.status;
  if (params.customer_type) where.customer_type = params.customer_type;

  const total = await models.Customer.count({ where });
  await reportProgress({ totalCount: total, processedCount: 0, progress: 5 });

  const batchSize = 500;
  const rows = [];
  let processed = 0;

  for (let offset = 0; offset < Math.max(total, 1); offset += batchSize) {
    const chunk = await models.Customer.findAll({
      where,
      offset,
      limit: batchSize,
      order: [["customer_id", "ASC"]],
    });

    for (const c of chunk) {
      rows.push({
        customer_id: c.customer_id,
        customer_type: c.customer_type,
        display_name:
          c.customer_type === "Business"
            ? c.company_name
            : `${c.first_name || ""} ${c.last_name || ""}`.trim(),
        nic_number: c.nic_number,
        phone_number: c.phone_number,
        address_line1: c.address_line1,
        rating: c.rating,
        deposit_balance: c.deposit_balance,
        status: c.status,
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
    fileName: `customers-export-${Date.now()}.csv`,
  });

  return {
    status: "completed",
    summary: `Exported ${rows.length} customer record(s) to CSV.`,
    outputFilePath,
    resultPayload: {
      download_url: `/api/bulk-jobs/${job.job_id}/download`,
      file_size_bytes: fileSize(outputFilePath),
      record_count: rows.length,
      format: "csv",
    },
  };
}
