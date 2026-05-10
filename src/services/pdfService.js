import PdfPrinter from "pdfmake";

const buildHeader = (tenantConfig, reportTitle, dateRange) => {
  const businessName = tenantConfig?.business_display_name || "GearGrid Business";
  const currency = tenantConfig?.currency_code || "LKR";
  return [
    { text: businessName, fontSize: 18, bold: true, color: "#1e293b", margin: [0, 0, 0, 4] },
    { text: reportTitle, fontSize: 14, color: "#475569", margin: [0, 0, 0, 4] },
    {
      text: dateRange
        ? `Period: ${dateRange.startDate} to ${dateRange.endDate}`
        : `Generated: ${new Date().toLocaleDateString()}`,
      fontSize: 9, color: "#94a3b8", margin: [0, 0, 0, 8],
    },
    { text: `Currency: ${currency}`, fontSize: 8, color: "#94a3b8", margin: [0, 0, 0, 16] },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: "#e2e8f0" }], margin: [0, 0, 0, 12] },
  ];
};

const buildTable = (headers, rows, widths) => {
  const headerRow = headers.map((h) => ({
    text: h, bold: true, fontSize: 9, color: "#1e293b",
    fillColor: "#f1f5f9", margin: [4, 6, 4, 6],
  }));
  const dataRows = rows.map((row, i) =>
    row.map((cell) => ({
      text: String(cell ?? "—"), fontSize: 8, color: "#334155",
      fillColor: i % 2 === 0 ? "#ffffff" : "#f8fafc", margin: [4, 4, 4, 4],
    })),
  );
  return {
    table: { headerRows: 1, widths: widths || headers.map(() => "*"), body: [headerRow, ...dataRows] },
    layout: {
      hLineWidth: () => 0.5, vLineWidth: () => 0.5,
      hLineColor: () => "#e2e8f0", vLineColor: () => "#e2e8f0",
    },
  };
};

export const generateProfitLossPdf = async (data, tenantConfig) => {
  const currency = tenantConfig?.currency_code || "LKR";
  const fmt = (v) => `${currency} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  const content = [
    ...buildHeader(tenantConfig, "Profit & Loss Statement", data.dateRange),
    { text: "Revenue", fontSize: 12, bold: true, color: "#16a34a", margin: [0, 8, 0, 6] },
    buildTable(["Description", "Amount"], [
      ["Gross Revenue (Payments Received)", fmt(data.grossRevenue)],
      ["Less: Refunds Issued", `(${fmt(data.totalRefunds)})`],
      ["Net Revenue", fmt(data.netRevenue)],
    ], [350, "*"]),
    { text: "Expenses", fontSize: 12, bold: true, color: "#dc2626", margin: [0, 16, 0, 6] },
    buildTable(["Category", "Count", "Total"],
      data.expenses.map((e) => [e.category, e.count, fmt(e.total)]), [200, 80, "*"]),
    { text: "Depreciation", fontSize: 12, bold: true, color: "#9333ea", margin: [0, 16, 0, 6] },
    buildTable(["Description", "Amount"],
      [["Equipment Depreciation (60 months)", fmt(data.periodDepreciation)]], [350, "*"]),
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: "#1e293b" }], margin: [0, 16, 0, 8] },
    {
      columns: [
        { text: "NET PROFIT / (LOSS)", fontSize: 14, bold: true },
        { text: fmt(data.netProfit), fontSize: 14, bold: true, alignment: "right", color: data.netProfit >= 0 ? "#16a34a" : "#dc2626" },
      ],
    },
  ];

  return {
    pageSize: "A4", pageMargins: [40, 40, 40, 60], content,
    footer: (currentPage, pageCount) => ({
      text: `Page ${currentPage} of ${pageCount}`, alignment: "center", fontSize: 7, color: "#94a3b8", margin: [0, 20, 0, 0],
    }),
    defaultStyle: { font: "Roboto" },
  };
};

export const generateAccountsReceivablePdf = async (data, tenantConfig) => {
  const currency = tenantConfig?.currency_code || "LKR";
  const fmt = (v) => `${currency} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  const bucketSections = Object.values(data.buckets).flatMap((bucket) => {
    if (bucket.rows.length === 0) {
      return [
        { text: bucket.label, fontSize: 11, bold: true, color: "#475569", margin: [0, 12, 0, 4] },
        { text: "No outstanding invoices.", fontSize: 9, color: "#94a3b8", margin: [0, 0, 0, 8] },
      ];
    }
    return [
      { text: `${bucket.label} — Total: ${fmt(bucket.total)}`, fontSize: 11, bold: true, color: "#475569", margin: [0, 12, 0, 4] },
      buildTable(
        ["Invoice", "Customer", "Phone", "Total", "Paid", "Outstanding", "Days"],
        bucket.rows.map((r) => [
          `INV-${r.invoice_id}`,
          r.customer_type === "Business" ? r.company_name : `${r.first_name} ${r.last_name}`,
          r.phone_number, fmt(r.total_amount), fmt(r.total_paid), fmt(r.outstanding), r.days_overdue,
        ]),
        [55, 110, 70, 65, 65, 70, 35],
      ),
    ];
  });

  return {
    pageSize: "A4", pageOrientation: "landscape", pageMargins: [30, 30, 30, 50],
    content: [
      ...buildHeader(tenantConfig, "Accounts Receivable — Aging Report", null),
      { columns: [
        { text: `Total Outstanding: ${fmt(data.grandTotal)}`, fontSize: 12, bold: true, color: "#dc2626" },
        { text: `Invoices: ${data.totalInvoices}`, fontSize: 12, alignment: "right", color: "#475569" },
      ], margin: [0, 0, 0, 8] },
      ...bucketSections,
    ],
    footer: (p, c) => ({ text: `Page ${p} of ${c}`, alignment: "center", fontSize: 7, color: "#94a3b8", margin: [0, 15, 0, 0] }),
    defaultStyle: { font: "Roboto" },
  };
};

export const createPdfBuffer = (docDefinition) => {
  return new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter({
        Roboto: {
          normal: Buffer.from(""), bold: Buffer.from(""),
          italics: Buffer.from(""), bolditalics: Buffer.from(""),
        },
      });
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks = [];
      pdfDoc.on("data", (chunk) => chunks.push(chunk));
      pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
      pdfDoc.on("error", reject);
      pdfDoc.end();
    } catch (err) {
      reject(err);
    }
  });
};
