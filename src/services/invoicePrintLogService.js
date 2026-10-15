import { Op } from "sequelize";
import AppError from "../utils/AppError.js";

/**
 * Record a new bill printing event with complete receipt snapshot and printer details.
 */
export const recordPrintLog = async (models, user, data, ipAddress = null) => {
  const printedByName =
    user?.first_name || user?.last_name
      ? `${user.first_name || ""} ${user.last_name || ""}`.trim()
      : user?.username || "Authorized Staff";

  const printedByRole = Array.isArray(user?.roles)
    ? user.roles[0]
    : typeof user?.roles === "string"
    ? user.roles
    : "Staff";

  // Sanitize numeric inputs
  const toNum = (val) => (val === undefined || val === null || isNaN(Number(val)) ? 0 : Number(val));

  const logRecord = await models.InvoicePrintLog.create({
    invoice_id: data.invoice_id ? Number(data.invoice_id) : null,
    doc_number: String(data.doc_number || "POS Receipt").trim(),
    doc_type: ["DISPATCH", "COMPLETED", "DRAFT", "RETURN_SETTLEMENT"].includes(data.doc_type)
      ? data.doc_type
      : "DISPATCH",
    printed_by_user_id: user?.userId || user?.id || 1,
    printed_by_name: printedByName,
    printed_by_role: printedByRole,
    customer_name: data.customer_name ? String(data.customer_name).slice(0, 150) : null,
    customer_phone: data.customer_phone ? String(data.customer_phone).slice(0, 50) : null,
    print_method: data.print_method === "browser_dialog" ? "browser_dialog" : "direct_agent",
    printer_name: data.printer_name ? String(data.printer_name).slice(0, 100) : "Default Thermal POS",
    paper_width: data.paper_width === "58mm" ? "58mm" : "80mm",
    copies: Math.max(1, Math.min(10, Number(data.copies) || 1)),
    height_mm: data.height_mm ? Math.round(Number(data.height_mm)) : null,
    total_items: Math.max(0, Math.round(toNum(data.total_items))),
    total_machines: Math.max(0, Math.round(toNum(data.total_machines))),
    subtotal: toNum(data.subtotal),
    transport_fee: toNum(data.transport_fee),
    discount_amount: toNum(data.discount_amount),
    grand_total: toNum(data.grand_total),
    total_paid: toNum(data.total_paid),
    balance_due: toNum(data.balance_due),
    language: data.language === "si" ? "si" : "en",
    custom_notes: data.custom_notes || null,
    bill_snapshot: data.bill_snapshot || null,
    ip_address: ipAddress || null,
    printed_at: new Date(),
  });

  // Log to InvoiceTrace if tied to an active invoice
  if (data.invoice_id && models.InvoiceTrace) {
    try {
      await models.InvoiceTrace.create({
        invoice_id: Number(data.invoice_id),
        actor_user_id: user?.userId || user?.id || null,
        event_category: "BILL_PRINTING",
        event_action: "RECEIPT_PRINTED",
        state_payload: {
          log_id: logRecord.log_id,
          doc_number: logRecord.doc_number,
          print_method: logRecord.print_method,
          printer_name: logRecord.printer_name,
          paper_width: logRecord.paper_width,
        },
        comments: `POS receipt printed by ${printedByName} (${printedByRole}) via ${
          logRecord.print_method === "direct_agent" ? "Direct Agent" : "Browser Dialog"
        }`,
      });
    } catch (traceErr) {
      console.warn("Could not append InvoiceTrace for print log:", traceErr.message);
    }
  }

  return logRecord;
};

/**
 * Retrieve paginated, searchable, filterable bill printing logs with aggregate statistics.
 */
export const getPrintLogs = async (models, query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(query.limit, 10) || 25));
  const offset = (page - 1) * limit;

  const where = {};

  // Text search on doc_number, customer_name, customer_phone, or printed_by_name
  if (query.search && query.search.trim()) {
    const term = `%${query.search.trim()}%`;
    where[Op.or] = [
      { doc_number: { [Op.like]: term } },
      { customer_name: { [Op.like]: term } },
      { customer_phone: { [Op.like]: term } },
      { printed_by_name: { [Op.like]: term } },
    ];
  }

  // Filter by document type
  if (query.docType && query.docType !== "ALL") {
    where.doc_type = query.docType;
  }

  // Filter by print method
  if (query.printMethod && query.printMethod !== "ALL") {
    where.print_method = query.printMethod;
  }

  // Filter by invoice ID
  if (query.invoiceId) {
    where.invoice_id = Number(query.invoiceId);
  }

  // Filter by staff user ID
  if (query.userId) {
    where.printed_by_user_id = Number(query.userId);
  }

  // Date range filters
  if (query.startDate && query.endDate) {
    const start = new Date(query.startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(query.endDate);
    end.setHours(23, 59, 59, 999);
    where.printed_at = { [Op.between]: [start, end] };
  } else if (query.startDate) {
    const start = new Date(query.startDate);
    start.setHours(0, 0, 0, 0);
    where.printed_at = { [Op.gte]: start };
  } else if (query.endDate) {
    const end = new Date(query.endDate);
    end.setHours(23, 59, 59, 999);
    where.printed_at = { [Op.lte]: end };
  }

  const { rows: logs, count: totalItems } = await models.InvoicePrintLog.findAndCountAll({
    where,
    limit,
    offset,
    order: [["printed_at", "DESC"]],
    include: [
      {
        model: models.User,
        as: "PrintedBy",
        attributes: ["user_id", "username", "first_name", "last_name", "avatar_url"],
        required: false,
      },
    ],
  });

  // Calculate high-level KPIs for management
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [totalAllTime, totalToday, totalDirect, totalDialog] = await Promise.all([
    models.InvoicePrintLog.count(),
    models.InvoicePrintLog.count({
      where: { printed_at: { [Op.gte]: todayStart } },
    }),
    models.InvoicePrintLog.count({
      where: { print_method: "direct_agent" },
    }),
    models.InvoicePrintLog.count({
      where: { print_method: "browser_dialog" },
    }),
  ]);

  return {
    logs,
    totalItems,
    totalPages: Math.ceil(totalItems / limit),
    currentPage: page,
    limit,
    stats: {
      totalPrintsAllTime: totalAllTime,
      totalPrintsToday: totalToday,
      totalDirectPrints: totalDirect,
      totalDialogPrints: totalDialog,
    },
  };
};

/**
 * Get detailed record of a single print log including its full bill_snapshot.
 */
export const getPrintLogById = async (models, logId) => {
  const log = await models.InvoicePrintLog.findByPk(logId, {
    include: [
      {
        model: models.User,
        as: "PrintedBy",
        attributes: ["user_id", "username", "first_name", "last_name", "avatar_url", "email", "phone_number"],
        required: false,
      },
      {
        model: models.Invoice,
        required: false,
      },
    ],
  });

  if (!log) {
    throw new AppError("Print audit log record not found.", 404);
  }

  return log;
};

/**
 * Get all print history specifically for one invoice.
 */
export const getInvoicePrintHistory = async (models, invoiceId) => {
  const history = await models.InvoicePrintLog.findAll({
    where: { invoice_id: Number(invoiceId) },
    order: [["printed_at", "DESC"]],
    include: [
      {
        model: models.User,
        as: "PrintedBy",
        attributes: ["user_id", "username", "first_name", "last_name", "avatar_url"],
        required: false,
      },
    ],
  });

  return history;
};
