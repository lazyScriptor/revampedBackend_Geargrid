import { Op } from "sequelize";
import { writeRowsToExcel } from "./_helpers.js";
import { fileSize } from "../../utils/jobFileStore.js";

const HEADERS = [
  { key: "invoice_id", label: "Invoice #", width: 12 },
  { key: "customer_name", label: "Customer", width: 28 },
  { key: "issued_date", label: "Issued", width: 14 },
  { key: "status", label: "Status", width: 12 },
  { key: "sub_total", label: "Subtotal", width: 12 },
  { key: "discount_amount", label: "Discount", width: 12 },
  { key: "transport_fee", label: "Transport", width: 12 },
  { key: "total_amount", label: "Total", width: 14 },
  { key: "advance_paid", label: "Advance", width: 12 },
  { key: "balance_due", label: "Balance", width: 12 },
];

export default async function exportInvoicesExcel(ctx) {
  const { tenantDbName, models, job, reportProgress } = ctx;
  const params = job.params || {};

  const where = {};
  if (params.status) where.status = params.status;
  if (params.startDate || params.endDate) {
    where.issued_date = {};
    if (params.startDate) where.issued_date[Op.gte] = new Date(params.startDate);
    if (params.endDate) where.issued_date[Op.lte] = new Date(params.endDate);
  }

  const total = await models.Invoice.count({ where });
  await reportProgress({ totalCount: total, processedCount: 0, progress: 5 });

  const batchSize = 200;
  const rows = [];
  let processed = 0;

  for (let offset = 0; offset < Math.max(total, 1); offset += batchSize) {
    const chunk = await models.Invoice.findAll({
      where,
      include: [
        {
          model: models.Customer,
          attributes: ["customer_type", "company_name", "first_name", "last_name"],
          required: false,
        },
      ],
      offset,
      limit: batchSize,
      order: [["invoice_id", "ASC"]],
    });

    for (const inv of chunk) {
      const c = inv.Customer;
      const customerName = c
        ? c.customer_type === "Business"
          ? c.company_name
          : `${c.first_name || ""} ${c.last_name || ""}`.trim()
        : "";
      const total = Number(inv.total_amount || 0);
      const advance = Number(inv.advance_paid || 0);
      rows.push({
        invoice_id: inv.invoice_id,
        customer_name: customerName,
        issued_date: inv.issued_date,
        status: inv.status,
        sub_total: inv.sub_total,
        discount_amount: inv.discount_amount,
        transport_fee: inv.transport_fee,
        total_amount: total,
        advance_paid: advance,
        balance_due: Math.max(0, total - advance),
      });
    }
    processed += chunk.length;
    await reportProgress({
      processedCount: processed,
      progress: Math.min(95, Math.round((processed / Math.max(total, 1)) * 90) + 5),
    });
  }

  const outputFilePath = await writeRowsToExcel({
    tenantDbName,
    jobId: job.job_id,
    sheetName: "Invoices",
    headers: HEADERS,
    rows,
    fileName: `invoices-export-${Date.now()}.xlsx`,
  });

  return {
    status: "completed",
    summary: `Exported ${rows.length} invoice record(s).`,
    outputFilePath,
    resultPayload: {
      download_url: `/api/bulk-jobs/${job.job_id}/download`,
      file_size_bytes: fileSize(outputFilePath),
      record_count: rows.length,
      format: "xlsx",
    },
  };
}
