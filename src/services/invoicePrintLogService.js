import { Op } from "sequelize";
import AppError from "../utils/AppError.js";

/**
 * Record a new bill printing event with complete receipt snapshot and printer details.
 */
export const recordPrintLog = async (models, user, data, ipAddress = null) => {
  const actorUserId = user?.userId || user?.id || 1;

  // Resolve full staff name & role from DB if JWT only carries username
  let dbUser = null;
  if (!user?.first_name && models.User) {
    try {
      dbUser = await models.User.findByPk(actorUserId, {
        attributes: ["user_id", "username", "first_name", "last_name"],
        include: models.Role
          ? [{ model: models.Role, attributes: ["role_name"], through: { attributes: [] } }]
          : [],
      });
    } catch {
      // ignore lookup error
    }
  }

  const firstName = user?.first_name || dbUser?.first_name || "";
  const lastName = user?.last_name || dbUser?.last_name || "";
  const username = user?.username || dbUser?.username || "";
  const fullName = `${firstName} ${lastName}`.trim();

  const printedByName =
    fullName && username
      ? `${fullName} (${username})`
      : fullName || username || "Authorized Staff";

  const printedByRole =
    Array.isArray(user?.roles) && user.roles.length > 0
      ? user.roles[0]
      : typeof user?.roles === "string" && user.roles
      ? user.roles
      : dbUser?.Roles?.[0]?.role_name || "Staff";

  // Sanitize numeric inputs
  const toNum = (val) => (val === undefined || val === null || isNaN(Number(val)) ? 0 : Number(val));

  // Resolve invoice_id from payload, snapshot, or doc_number (e.g. INV-67)
  let resolvedInvoiceId = data.invoice_id
    ? Number(data.invoice_id)
    : data.bill_snapshot?.invoice_id
    ? Number(data.bill_snapshot.invoice_id)
    : null;

  if (!resolvedInvoiceId && typeof data.doc_number === "string") {
    const match = data.doc_number.trim().match(/^INV-(\d+)$/i);
    if (match) resolvedInvoiceId = Number(match[1]);
  }

  // If linked to an invoice and snapshot or financial metadata is missing, enrich from DB
  let dbInvoice = null;
  if (resolvedInvoiceId && models.Invoice) {
    try {
      const plainRes = await models.Invoice.findByPk(resolvedInvoiceId, {
        include: [
          ...(models.Customer ? [{ model: models.Customer }] : []),
          ...(models.Customer
            ? [{ model: models.Customer, as: "OnBehalfOfCustomer", required: false }]
            : []),
          ...(models.InvoiceLine
            ? [
                {
                  model: models.InvoiceLine,
                  include: models.Equipment ? [{ model: models.Equipment }] : [],
                },
              ]
            : []),
          ...(models.Payment ? [{ model: models.Payment }] : []),
        ],
      });
      if (plainRes) dbInvoice = plainRes.get({ plain: true });
    } catch {
      // non-fatal
    }
  }

  const snap = data.bill_snapshot || {};
  const cust =
    snap.Customer ||
    snap.customer ||
    dbInvoice?.Customer ||
    null;

  const derivedCustName =
    data.customer_name ||
    cust?.company_name ||
    `${cust?.first_name || ""} ${cust?.last_name || ""}`.trim() ||
    null;

  const derivedCustPhone =
    data.customer_phone || cust?.phone_number || null;

  const lines =
    snap.InvoiceLines ||
    snap.items ||
    dbInvoice?.InvoiceLines ||
    [];

  const payments =
    snap.Payments ||
    dbInvoice?.Payments ||
    [];

  const derivedSubtotal =
    toNum(data.subtotal) ||
    toNum(snap.sub_total ?? snap.fees?.subtotal ?? dbInvoice?.sub_total);
  const derivedTransport =
    toNum(data.transport_fee) ||
    toNum(snap.transport_fee ?? snap.fees?.transportFee ?? snap.fees?.transport ?? dbInvoice?.transport_fee);
  const derivedDiscount =
    toNum(data.discount_amount) ||
    toNum(snap.discount_amount ?? snap.fees?.discountAmount ?? snap.fees?.discount ?? dbInvoice?.discount_amount);
  const derivedGrandTotal =
    toNum(data.grand_total) ||
    toNum(snap.total_amount ?? snap.fees?.grandTotal ?? dbInvoice?.total_amount);
  const derivedTotalPaid =
    toNum(data.total_paid) ||
    toNum(
      snap.fees?.totalPaid ??
        snap.fees?.advance ??
        payments.reduce((s, p) => s + toNum(p.payment_amount), 0)
    );
  const derivedBalanceDue =
    data.balance_due !== undefined && data.balance_due !== null
      ? toNum(data.balance_due)
      : Math.max(0, derivedGrandTotal - derivedTotalPaid);

  const derivedTotalItems =
    Math.max(0, Math.round(toNum(data.total_items))) || lines.length;
  const derivedTotalMachines =
    Math.max(0, Math.round(toNum(data.total_machines))) ||
    lines.reduce((acc, it) => acc + Math.max(1, toNum(it.borrow_quantity || it.quantity || 1)), 0);

  const normalizedDocNumber = String(
    data.doc_number || (resolvedInvoiceId ? `INV-${resolvedInvoiceId}` : "POS Receipt")
  ).trim();

  const resolvedDocType = ["DISPATCH", "COMPLETED", "DRAFT", "RETURN_SETTLEMENT"].includes(
    data.doc_type
  )
    ? data.doc_type
    : dbInvoice?.status === "Completed"
    ? "COMPLETED"
    : "DISPATCH";

  // Build a complete, backward- and forward-compatible bill_snapshot
  const enrichedSnapshot =
    data.bill_snapshot || dbInvoice
      ? {
          ...(dbInvoice || {}),
          ...(data.bill_snapshot || {}),
          invoice_id: resolvedInvoiceId,
          doc_number: normalizedDocNumber,
          status:
            snap.status ||
            dbInvoice?.status ||
            (resolvedDocType === "COMPLETED" ? "Completed" : "Active"),
          issued_date:
            snap.issued_date || dbInvoice?.issued_date || new Date().toISOString(),
          sub_total: derivedSubtotal,
          transport_fee: derivedTransport,
          discount_amount: derivedDiscount,
          total_amount: derivedGrandTotal,
          Customer: cust,
          customer: cust,
          OnBehalfOfCustomer:
            snap.OnBehalfOfCustomer ||
            snap.onBehalfOfCustomer ||
            dbInvoice?.OnBehalfOfCustomer ||
            null,
          InvoiceLines: lines,
          items: lines,
          Payments: payments,
          fees: {
            subtotal: derivedSubtotal,
            transportFee: derivedTransport,
            discountAmount: derivedDiscount,
            grandTotal: derivedGrandTotal,
            totalPaid: derivedTotalPaid,
            balanceDue: derivedBalanceDue,
            transport: derivedTransport,
            discount: derivedDiscount,
            advance: derivedTotalPaid,
          },
          language: data.language === "si" ? "si" : "en",
          customNotes: data.custom_notes ?? snap.customNotes ?? null,
        }
      : null;

  const logRecord = await models.InvoicePrintLog.create({
    invoice_id: resolvedInvoiceId,
    doc_number: normalizedDocNumber,
    doc_type: resolvedDocType,
    printed_by_user_id: actorUserId,
    printed_by_name: printedByName,
    printed_by_role: printedByRole,
    customer_name: derivedCustName ? String(derivedCustName).slice(0, 150) : null,
    customer_phone: derivedCustPhone ? String(derivedCustPhone).slice(0, 50) : null,
    print_method: data.print_method === "browser_dialog" ? "browser_dialog" : "direct_agent",
    printer_name: data.printer_name ? String(data.printer_name).slice(0, 100) : "Default Thermal POS",
    paper_width: data.paper_width === "58mm" ? "58mm" : "80mm",
    copies: Math.max(1, Math.min(10, Number(data.copies) || 1)),
    height_mm: data.height_mm ? Math.round(Number(data.height_mm)) : null,
    total_items: derivedTotalItems,
    total_machines: derivedTotalMachines,
    subtotal: derivedSubtotal,
    transport_fee: derivedTransport,
    discount_amount: derivedDiscount,
    grand_total: derivedGrandTotal,
    total_paid: derivedTotalPaid,
    balance_due: derivedBalanceDue,
    language: data.language === "si" ? "si" : "en",
    custom_notes: data.custom_notes || null,
    bill_snapshot: enrichedSnapshot,
    ip_address: ipAddress || null,
    printed_at: new Date(),
  });

  // Log to InvoiceTrace if tied to an active invoice
  if (resolvedInvoiceId && models.InvoiceTrace) {
    try {
      await models.InvoiceTrace.create({
        invoice_id: resolvedInvoiceId,
        actor_user_id: actorUserId,
        event_category: "BILL_PRINTING",
        event_action: "RECEIPT_PRINTED",
        state_payload: {
          log_id: logRecord.log_id,
          doc_number: logRecord.doc_number,
          print_method: logRecord.print_method,
          printer_name: logRecord.printer_name,
          paper_width: logRecord.paper_width,
          grand_total: derivedGrandTotal,
          balance_due: derivedBalanceDue,
          printed_by_name: printedByName,
          printed_by_role: printedByRole,
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

  // Calculate start of current business day in Sri Lanka (Asia/Colombo, UTC+5:30)
  const slOffsetMs = 5.5 * 60 * 60 * 1000;
  const nowSl = new Date(Date.now() + slOffsetMs);
  nowSl.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(nowSl.getTime() - slOffsetMs);

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
  const numericId = Number(invoiceId);
  const history = await models.InvoicePrintLog.findAll({
    where: {
      [Op.or]: [
        { invoice_id: numericId },
        { doc_number: `INV-${numericId}` },
      ],
    },
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
