import { Op } from "sequelize";
import { liveTotalOf, owedAmount } from "../utils/invoiceBalance.js";
import { dayInShopTz, isOpenEndedLine, lateDays } from "../utils/rentalDays.js";
import { normalizePhone } from "../utils/whatsappPhone.js";
import { extractCustomerPhoneEntries, findCustomerIdsByPhone } from "./customerPhoneService.js";

const OPEN_STATUSES = new Set(["Active", "PendingPayment"]);
const MAX_ACTIVE_ITEMS = 5;
const MAX_SYNC_LIMIT = 500;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const toYmd = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : dayInShopTz(value);
  }
  const str = String(value).trim();
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : dayInShopTz(parsed);
};

const toIso = (value, fallbackDate) => {
  const date = value ? new Date(value) : fallbackDate;
  if (Number.isNaN(date.getTime())) {
    return fallbackDate.toISOString();
  }
  return date.toISOString();
};

const normalizeCustomerIds = (customerIds) => {
  const raw = Array.isArray(customerIds) ? customerIds : [customerIds];
  const seen = new Set();
  const out = [];
  for (const id of raw) {
    const n = Number(id);
    if (Number.isInteger(n) && n > 0 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
};

const formatDisplayName = (customer) => {
  const full = [customer.first_name, customer.last_name]
    .map((s) => (s ? String(s).trim() : ""))
    .filter(Boolean)
    .join(" ");
  if (full) return full;
  if (customer.company_name && String(customer.company_name).trim()) {
    return String(customer.company_name).trim();
  }
  return `Customer #${customer.customer_id}`;
};

const formatParentCompany = (customer) => {
  const parent = customer.ParentCompany;
  if (!parent) return null;
  if (parent.company_name && String(parent.company_name).trim()) {
    return String(parent.company_name).trim();
  }
  const full = [parent.first_name, parent.last_name]
    .map((s) => (s ? String(s).trim() : ""))
    .filter(Boolean)
    .join(" ");
  return full || null;
};

const composeSummaryLine = ({
  rating,
  balanceDue,
  activeItemCount,
  overdueItemCount,
  maxOverdueDays,
  invoiceCount,
  firstRental,
}) => {
  const parts = [];
  if (rating !== null && rating > 0) {
    parts.push(`★${Math.round(rating)}`);
  }
  if (balanceDue > 0) {
    parts.push(`Owes LKR ${Math.round(balanceDue).toLocaleString("en-US")}`);
  }
  if (overdueItemCount > 0) {
    parts.push(
      `${overdueItemCount} ${overdueItemCount === 1 ? "item" : "items"} overdue ${maxOverdueDays} ${
        maxOverdueDays === 1 ? "day" : "days"
      }`,
    );
  } else if (activeItemCount > 0) {
    parts.push(`${activeItemCount} ${activeItemCount === 1 ? "item" : "items"} out`);
  }
  if (invoiceCount > 0) {
    const firstYear = firstRental ? String(firstRental).slice(0, 4) : null;
    parts.push(
      `${invoiceCount} ${invoiceCount === 1 ? "rental" : "rentals"}${
        firstYear ? ` since ${firstYear}` : ""
      }`,
    );
  }
  return parts.join(" · ");
};

/**
 * Mark customer briefs stale so the next incremental phone sync pulls updates.
 */
export const touchCustomerBrief = async (models, customerIds, { transaction, now = new Date() } = {}) => {
  const ids = normalizeCustomerIds(customerIds);
  if (ids.length === 0 || !models?.Customer?.update) return 0;

  await models.Customer.update(
    { brief_changed_at: now },
    {
      where: {
        customer_id: ids.length === 1 ? ids[0] : { [Op.in]: ids },
      },
      ...(transaction ? { transaction } : {}),
    },
  );
  return ids.length;
};

/**
 * Build compact caller briefs for a batch of customer IDs using grouped queries.
 */
export const buildBriefs = async (models, customerIds, { now = new Date() } = {}) => {
  const requestedIds = normalizeCustomerIds(customerIds);
  if (requestedIds.length === 0 || !models?.Customer?.findAll) return [];

  const today = dayInShopTz(now);

  const customers = await models.Customer.findAll({
    where: {
      customer_id: { [Op.in]: requestedIds },
      customer_delete_status: false,
    },
    include: [
      {
        model: models.Customer,
        as: "ParentCompany",
        attributes: ["customer_id", "company_name", "first_name", "last_name"],
        required: false,
      },
    ],
  });

  if (!customers || customers.length === 0) return [];

  const customerById = new Map();
  for (const cust of customers) {
    if (cust.customer_delete_status) continue;
    customerById.set(Number(cust.customer_id), cust);
  }
  const activeIds = requestedIds.filter((id) => customerById.has(id));
  if (activeIds.length === 0) return [];

  const [phoneRows, invoices, reviews] = await Promise.all([
    models.CustomerPhone?.findAll
      ? models.CustomerPhone.findAll({
          where: { customer_id: { [Op.in]: activeIds } },
          attributes: ["phone_id", "customer_id", "phone_e164", "is_primary"],
          order: [
            ["is_primary", "DESC"],
            ["phone_id", "ASC"],
          ],
          raw: true,
        })
      : Promise.resolve([]),
    models.Invoice?.findAll
      ? models.Invoice.findAll({
          where: {
            customer_id: { [Op.in]: activeIds },
            is_deleted: false,
          },
          include: [
            ...(models.InvoiceLine
              ? [
                  {
                    model: models.InvoiceLine,
                    required: false,
                    include: models.Equipment
                      ? [
                          {
                            model: models.Equipment,
                            attributes: ["equipment_id", "equipment_name"],
                            required: false,
                          },
                        ]
                      : [],
                  },
                ]
              : []),
            ...(models.Payment
              ? [
                  {
                    model: models.Payment,
                    required: false,
                    attributes: [
                      "payment_id",
                      "invoice_id",
                      "payment_amount",
                      "payment_date",
                      "method",
                      "is_voided",
                    ],
                  },
                ]
              : []),
          ],
        })
      : Promise.resolve([]),
    models.InvoiceReview?.findAll
      ? models.InvoiceReview.findAll({
          where: {
            customer_id: { [Op.in]: activeIds },
            comment: { [Op.ne]: null },
          },
          attributes: ["review_id", "customer_id", "comment", "createdAt"],
          order: [
            ["createdAt", "DESC"],
            ["review_id", "DESC"],
          ],
          raw: true,
        })
      : Promise.resolve([]),
  ]);

  const phonesByCustomer = new Map();
  for (const row of phoneRows || []) {
    const cid = Number(row.customer_id);
    const list = phonesByCustomer.get(cid) || [];
    if (row.phone_e164 && !list.includes(row.phone_e164)) {
      list.push(row.phone_e164);
    }
    phonesByCustomer.set(cid, list);
  }

  const invoicesByCustomer = new Map();
  for (const inv of invoices || []) {
    if (inv.is_deleted) continue;
    const cid = Number(inv.customer_id);
    const list = invoicesByCustomer.get(cid) || [];
    list.push(inv);
    invoicesByCustomer.set(cid, list);
  }

  const reviewByCustomer = new Map();
  for (const rev of reviews || []) {
    const cid = Number(rev.customer_id);
    if (reviewByCustomer.has(cid)) continue;
    const text = rev.comment ? String(rev.comment).trim() : "";
    if (text) {
      reviewByCustomer.set(cid, text);
    }
  }

  return activeIds.map((cid) => {
    const customer = customerById.get(cid);
    const custPhones = phonesByCustomer.get(cid) || [];
    const phones =
      custPhones.length > 0
        ? custPhones
        : extractCustomerPhoneEntries(customer.phone_number).map((e) => e.phone_e164);

    const custInvoices = invoicesByCustomer.get(cid) || [];
    const invoiceCount = custInvoices.length;

    let firstRental = null;
    let lastRental = null;
    let balanceDueSum = 0;
    let idRetained = Boolean(customer.is_id_retained_currently);
    const allActiveItems = [];
    let latestPayment = null;
    let latestPaymentTs = -Infinity;
    let latestPaymentId = -1;

    for (const inv of custInvoices) {
      const issuedYmd = toYmd(inv.issued_date);
      if (issuedYmd) {
        if (!firstRental || issuedYmd < firstRental) firstRental = issuedYmd;
        if (!lastRental || issuedYmd > lastRental) lastRental = issuedYmd;
      }

      const activePayments = (inv.Payments || []).filter((p) => !p.is_voided);
      for (const p of activePayments) {
        const amt = Number(p.payment_amount || 0);
        if (amt <= 0) continue;
        const ts = p.payment_date ? new Date(p.payment_date).getTime() : 0;
        const pid = Number(p.payment_id || 0);
        if (ts > latestPaymentTs || (ts === latestPaymentTs && pid > latestPaymentId)) {
          latestPaymentTs = ts;
          latestPaymentId = pid;
          latestPayment = {
            amount: round2(amt),
            date: toYmd(p.payment_date),
            method: p.method ? String(p.method) : null,
          };
        }
      }

      if (OPEN_STATUSES.has(inv.status)) {
        const invOwed = Math.max(0, owedAmount(liveTotalOf(inv), activePayments));
        balanceDueSum += invOwed;
        if (Number(inv.id_card_status) === 1) {
          idRetained = true;
        }

        for (const line of inv.InvoiceLines || []) {
          if (line.line_status === "Completed") continue;
          const pending = Math.max(
            0,
            Number(line.borrow_quantity || 0) -
              Number(line.good_returned_qty || 0) -
              Number(line.defective_returned_qty || 0),
          );
          if (pending <= 0) continue;

          const openEnded = isOpenEndedLine(line);
          const due = openEnded ? null : toYmd(line.expected_return_date);
          const tracked = !(
            line.track_overdue === false ||
            line.track_overdue === 0 ||
            line.track_overdue === "0"
          );
          const overdueDays =
            openEnded || !tracked || !line.expected_return_date
              ? 0
              : lateDays(line.expected_return_date, today);

          allActiveItems.push({
            name: line.Equipment?.equipment_name || `Equipment #${line.equipment_id}`,
            qty: pending,
            due,
            overdue_days: overdueDays,
          });
        }
      }
    }

    allActiveItems.sort((a, b) => {
      if (b.overdue_days !== a.overdue_days) return b.overdue_days - a.overdue_days;
      if ((a.due || "9999-99-99") !== (b.due || "9999-99-99")) {
        return (a.due || "9999-99-99").localeCompare(b.due || "9999-99-99");
      }
      return a.name.localeCompare(b.name);
    });

    const overdueItems = allActiveItems.filter((item) => item.overdue_days > 0);
    const maxOverdueDays = overdueItems.reduce(
      (max, item) => Math.max(max, item.overdue_days),
      0,
    );

    const balanceDue = round2(balanceDueSum);
    const depositBalance = round2(customer.deposit_balance);
    const rating = customer.rating !== null && customer.rating !== undefined ? Number(customer.rating) : null;

    const summaryLine = composeSummaryLine({
      rating,
      balanceDue,
      activeItemCount: allActiveItems.length,
      overdueItemCount: overdueItems.length,
      maxOverdueDays,
      invoiceCount,
      firstRental,
    });

    return {
      customer_id: cid,
      display_name: formatDisplayName(customer),
      company_name: customer.company_name ? String(customer.company_name).trim() || null : null,
      parent_company: formatParentCompany(customer),
      phones,
      rating,
      status: String(customer.status || "Active"),
      balance_due: balanceDue,
      deposit_balance: depositBalance,
      id_retained: idRetained,
      active_items: allActiveItems.slice(0, MAX_ACTIVE_ITEMS),
      invoice_count: invoiceCount,
      first_rental: firstRental,
      last_rental: lastRental,
      last_payment: latestPayment,
      last_review_comment: reviewByCustomer.get(cid) ?? null,
      summary_line: summaryLine,
      updated_at: toIso(customer.brief_changed_at || customer.updatedAt, now),
    };
  });
};

/**
 * Paginated delta/full brief sync for a paired operator device.
 */
export const syncDeviceBriefs = async (models, device, query = {}, { now = new Date() } = {}) => {
  const limitRaw = parseInt(query.limit, 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_SYNC_LIMIT, Math.max(1, limitRaw))
    : MAX_SYNC_LIMIT;
  const cursorRaw = parseInt(query.cursor, 10);
  const cursor = Number.isFinite(cursorRaw) && cursorRaw > 0 ? cursorRaw : 0;

  let sinceDate = null;
  if (query.since) {
    const parsed = new Date(query.since);
    if (!Number.isNaN(parsed.getTime())) {
      sinceDate = parsed;
    }
  }

  const where = {
    customer_delete_status: false,
    ...(cursor > 0 ? { customer_id: { [Op.gt]: cursor } } : {}),
    ...(sinceDate
      ? {
          [Op.or]: [
            { brief_changed_at: { [Op.gt]: sinceDate } },
            { updatedAt: { [Op.gt]: sinceDate } },
          ],
        }
      : {}),
  };

  const rows = await models.Customer.findAll({
    where,
    attributes: ["customer_id"],
    order: [["customer_id", "ASC"]],
    limit: limit + 1,
    raw: true,
  });

  const hasMore = rows.length > limit;
  const pageIds = rows.slice(0, limit).map((r) => Number(r.customer_id));
  const nextCursor = hasMore && pageIds.length > 0 ? pageIds[pageIds.length - 1] : null;

  const briefs = await buildBriefs(models, pageIds, { now });

  let deletedCustomerIds = [];
  if (sinceDate && cursor === 0 && models.Customer?.findAll) {
    const deletedRows = await models.Customer.findAll({
      where: {
        customer_delete_status: true,
        [Op.or]: [
          { brief_changed_at: { [Op.gt]: sinceDate } },
          { updatedAt: { [Op.gt]: sinceDate } },
        ],
      },
      attributes: ["customer_id"],
      raw: true,
    });
    deletedCustomerIds = (deletedRows || []).map((r) => Number(r.customer_id)).filter(Boolean);
  }

  if (!hasMore && device?.update) {
    await device.update({ briefs_synced_at: now });
  }

  return {
    briefs,
    deleted_customer_ids: deletedCustomerIds,
    next_cursor: nextCursor,
    server_time: now.toISOString(),
  };
};

/**
 * Fallback lookup by raw phone when the phone's local Room cache misses.
 */
export const lookupDeviceBrief = async (models, _device, query = {}) => {
  const rawPhone = String(query.phone || "").trim();
  if (!rawPhone) {
    return { match: "none", brief: null, contact: null };
  }

  const customerIds = await findCustomerIdsByPhone(models, rawPhone);
  if (customerIds.length > 0) {
    const briefs = await buildBriefs(models, customerIds);
    if (briefs.length > 0) {
      return {
        match: "customer",
        brief: briefs[0],
        contact: null,
      };
    }
  }

  const normalized = normalizePhone(rawPhone);
  if (normalized.digits && models.PhoneContact?.findOne) {
    const contact = await models.PhoneContact.findOne({
      where: { phone_e164: normalized.digits },
      include: models.OperatorDevice
        ? [
            {
              model: models.OperatorDevice,
              attributes: ["device_label"],
              required: false,
            },
          ]
        : [],
      order: [
        ["last_used_at", "DESC"],
        ["contact_id", "ASC"],
      ],
    });

    if (contact) {
      return {
        match: "contact",
        brief: null,
        contact: {
          contact_id: Number(contact.contact_id),
          display_name: contact.display_name,
          phone_e164: contact.phone_e164,
          device_label: contact.OperatorDevice?.device_label ?? null,
        },
      };
    }
  }

  return { match: "none", brief: null, contact: null };
};
