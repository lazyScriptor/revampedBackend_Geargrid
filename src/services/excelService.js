import ExcelJS from "exceljs";

const HEADER_STYLE = {
  font: { bold: true, color: { argb: "FF1E293B" }, size: 10 },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } },
  border: {
    bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
  },
  alignment: { vertical: "middle" },
};

const CURRENCY_FORMAT = '#,##0.00;[Red]-#,##0.00';

const applyHeaderStyle = (row) => {
  row.eachCell((cell) => {
    cell.font = HEADER_STYLE.font;
    cell.fill = HEADER_STYLE.fill;
    cell.border = HEADER_STYLE.border;
    cell.alignment = HEADER_STYLE.alignment;
  });
  row.height = 24;
};

const autoFitColumns = (worksheet) => {
  worksheet.columns.forEach((col) => {
    let maxLength = col.header ? col.header.length : 10;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > maxLength) maxLength = len;
    });
    col.width = Math.min(maxLength + 4, 40);
  });
};

// ============================================================================
// PROFIT & LOSS EXCEL
// ============================================================================
export const generateProfitLossExcel = async (data, tenantConfig) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = tenantConfig?.business_display_name || "GearGrid";
  workbook.created = new Date();

  const currency = tenantConfig?.currency_code || "LKR";
  const ws = workbook.addWorksheet("Profit & Loss");

  // Title
  ws.mergeCells("A1:C1");
  ws.getCell("A1").value = `${tenantConfig?.business_display_name || "GearGrid"} — Profit & Loss Statement`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A2:C2");
  ws.getCell("A2").value = `Period: ${data.dateRange.startDate} to ${data.dateRange.endDate} | Currency: ${currency}`;
  ws.getCell("A2").font = { size: 10, color: { argb: "FF64748B" } };
  ws.addRow([]);

  // Revenue
  const revHeader = ws.addRow(["Revenue", "", ""]);
  revHeader.getCell(1).font = { bold: true, size: 11, color: { argb: "FF16A34A" } };
  const rh = ws.addRow(["Description", "Amount", ""]);
  applyHeaderStyle(rh);
  ws.addRow(["Gross Revenue", data.grossRevenue]);
  ws.addRow(["Less: Refunds", -data.totalRefunds]);
  ws.addRow(["Net Revenue", data.netRevenue]);
  ws.addRow([]);

  // Expenses
  const expHeader = ws.addRow(["Expenses by Category", "", ""]);
  expHeader.getCell(1).font = { bold: true, size: 11, color: { argb: "FFDC2626" } };
  const eh = ws.addRow(["Category", "Count", "Total"]);
  applyHeaderStyle(eh);
  for (const exp of data.expenses) {
    ws.addRow([exp.category, parseInt(exp.count), parseFloat(exp.total)]);
  }
  ws.addRow(["Total Expenses", "", data.totalExpenses]);
  ws.addRow([]);

  // Depreciation
  ws.addRow(["Equipment Depreciation", data.periodDepreciation]);
  ws.addRow([]);

  // Net Profit
  const profitRow = ws.addRow(["NET PROFIT / (LOSS)", data.netProfit]);
  profitRow.getCell(1).font = { bold: true, size: 12 };
  profitRow.getCell(2).font = { bold: true, size: 12, color: { argb: data.netProfit >= 0 ? "FF16A34A" : "FFDC2626" } };
  profitRow.getCell(2).numFmt = CURRENCY_FORMAT;

  autoFitColumns(ws);
  return workbook;
};

// ============================================================================
// ACCOUNTS RECEIVABLE EXCEL
// ============================================================================
export const generateAccountsReceivableExcel = async (data, tenantConfig) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = tenantConfig?.business_display_name || "GearGrid";

  const ws = workbook.addWorksheet("Accounts Receivable");

  ws.mergeCells("A1:G1");
  ws.getCell("A1").value = `${tenantConfig?.business_display_name || "GearGrid"} — Accounts Receivable`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.addRow([]);

  for (const bucket of Object.values(data.buckets)) {
    const bh = ws.addRow([bucket.label]);
    bh.getCell(1).font = { bold: true, size: 11, color: { argb: "FF475569" } };

    if (bucket.rows.length === 0) {
      ws.addRow(["No outstanding invoices"]);
      ws.addRow([]);
      continue;
    }

    const hdr = ws.addRow(["Invoice #", "Customer", "Phone", "Total", "Paid", "Outstanding", "Days Overdue"]);
    applyHeaderStyle(hdr);

    for (const r of bucket.rows) {
      const customerName = r.customer_type === "Business" ? r.company_name : `${r.first_name} ${r.last_name}`;
      ws.addRow([
        `INV-${r.invoice_id}`, customerName, r.phone_number,
        parseFloat(r.total_amount), parseFloat(r.total_paid),
        parseFloat(r.outstanding), parseInt(r.days_overdue),
      ]);
    }
    const totalRow = ws.addRow(["", "", "", "", "", bucket.total, ""]);
    totalRow.getCell(6).font = { bold: true };
    totalRow.getCell(6).numFmt = CURRENCY_FORMAT;
    ws.addRow([]);
  }

  autoFitColumns(ws);
  return workbook;
};

// ============================================================================
// EQUIPMENT UTILIZATION EXCEL
// ============================================================================
export const generateUtilizationExcel = async (data, tenantConfig) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = tenantConfig?.business_display_name || "GearGrid";

  const ws = workbook.addWorksheet("Equipment Utilization");
  ws.mergeCells("A1:H1");
  ws.getCell("A1").value = "Equipment Utilization & ROI Report";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.addRow([]);

  const hdr = ws.addRow(["Equipment", "Category", "Warehouse", "Purchase Cost", "Revenue", "ROI %", "Utilization %", "Status"]);
  applyHeaderStyle(hdr);

  for (const row of data) {
    const status = row.rented_qty > 0 ? "In Use" : "Idle";
    ws.addRow([
      row.equipment_name, row.category_name, row.warehouse,
      parseFloat(row.purchase_cost) || 0, parseFloat(row.total_revenue) || 0,
      row.roiPct !== null ? `${row.roiPct}%` : "N/A",
      `${row.utilizationPct}%`, status,
    ]);
  }

  autoFitColumns(ws);
  return workbook;
};
