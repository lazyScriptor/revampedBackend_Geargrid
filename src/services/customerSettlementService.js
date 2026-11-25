import crypto from "node:crypto";
import { Op, QueryTypes } from "sequelize";
import AppError from "../utils/AppError.js";
import { parseJsonField } from "../utils/jsonFields.js";
import {
  OPEN_INVOICE_STATUSES_SQL,
  PAID_PER_INVOICE_SQL,
  liveTotalExpr,
  owedExpr,
  unitsOutExpr,
  lineStillOutSql,
} from "../utils/invoiceBalance.js";
import {
  chargeableLateDays,
  dayInShopTz,
  isOpenEndedLine,
  lineOutMoment,
  openEndedExtraDays,
  wholeDaysBetween,
} from "../utils/rentalDays.js";
import {
  completeInvoice,
  executeReturnOnInvoice,
  resolveIssuedDate,
} from "./invoiceService.js";
import { validateReason } from "./activitySettingsService.js";
import { recordActivity } from "./activityService.js";
import { touchCustomerBrief } from "./customerBriefService.js";

const MAX_BILLS_PER_SETTLEMENT = 200;
const MAX_LINES_PER_SETTLEMENT = 500;
const BALANCE_TOLERANCE = 0.005;
const FUTURE_SLACK_MS = 5 * 60 * 1000;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toCents = (n) => Math.round((Number(n) || 0) * 100);
const fromCents = (c) => Math.round(c) / 100;

const formatLkr = (n) => {
  const num = Number(n || 0);
  return Number.isInteger(num)
    ? num.toLocaleString("en-US")
    : num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatCustomerName = (c) => {
  if (!c) return "Customer";
  if (c.customer_type === "Business" && c.company_name) return c.company_name;
  return `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.company_name || `Customer #${c.customer_id}`;
};

const resolvePastOrToday = (value, label, now = new Date()) => {
  if (value === undefined || value === null || value === "") return now;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`The ${label} is not a valid date.`, 400);
  }
  const valueYmd = dayInShopTz(date);
  const todayYmd = dayInShopTz(now);
  if (valueYmd > todayYmd || date.getTime() > now.getTime() + FUTURE_SLACK_MS) {
    throw new AppError(`The ${label} cannot be in the future.`, 400);
  }
  return date;
};

const ageBucketOf = (ageDays) => {
  if (ageDays < 7) return "green";
  if (ageDays <= 30) return "amber";
  return "red";
};

const maybeRecordActivity = async (models, event, opts) => {
  if (models?.ActivityEvent?.create) {
    return recordActivity(models, event, opts);
  }
  return null;
};

/**
 * 1. GET /api/customers/:id/settlement/overview
 * Returns customer card numbers and machines bar (per equipment_id still out) in ONE SQL query
 * using the shared invoiceBalance.js SQL expressions.
 */
export const getSettlementOverview = async (models, customerId) => {
  const cid = Number(customerId);
  if (!Number.isInteger(cid) || cid <= 0) {
    throw new AppError("Invalid customer id.", 400);
  }

  const customer = await models.Customer.findByPk(cid);
  if (!customer || customer.customer_delete_status) {
    throw new AppError("Customer not found.", 404);
  }

  // Single SQL query for all open bills + active lines still out
  const rows = await models.sequelize.query(
    `SELECT
       i.invoice_id,
       i.issued_date,
       i.status,
       i.id_card_status,
       i.borrowed_on_behalf_of_customer_id,
       ${liveTotalExpr("i")} AS live_total,
       COALESCE(p.total_paid, 0) AS amount_paid,
       ${owedExpr("i", "p.total_paid")} AS owed,
       il.line_id,
       il.equipment_id,
       il.expected_return_date,
       il.locked_extra_daily_rate,
       ${unitsOutExpr("il")} AS units_out,
       e.equipment_name,
       e.equipment_name_si,
       e.serial_number,
       e.is_bulk_item,
       e.image_url,
       e.category_id,
       ec.category_name
     FROM INVOICES i
     LEFT JOIN ${PAID_PER_INVOICE_SQL} p ON p.invoice_id = i.invoice_id
     LEFT JOIN INVOICE_LINES il ON il.invoice_id = i.invoice_id AND ${lineStillOutSql("il")}
     LEFT JOIN EQUIPMENT e ON e.equipment_id = il.equipment_id
     LEFT JOIN EQUIPMENT_CATEGORIES ec ON ec.category_id = e.category_id
     WHERE i.is_deleted = 0
       AND i.customer_id = :customerId
       AND i.status IN ${OPEN_INVOICE_STATUSES_SQL}
     ORDER BY i.issued_date ASC, i.invoice_id ASC, il.line_id ASC`,
    {
      replacements: { customerId: cid },
      type: QueryTypes.SELECT,
    },
  );

  // Fetch last payment for customer card small facts
  let lastPayment = null;
  if (models.Payment?.findOne) {
    const lp = await models.Payment.findOne({
      where: { is_voided: false, payment_amount: { [Op.gt]: 0 } },
      include: [
        {
          model: models.Invoice,
          attributes: ["invoice_id", "customer_id"],
          where: { customer_id: cid, is_deleted: false },
          required: true,
        },
      ],
      order: [["payment_date", "DESC"], ["payment_id", "DESC"]],
    });
    if (lp) {
      lastPayment = {
        payment_id: lp.payment_id,
        invoice_id: lp.invoice_id,
        payment_amount: round2(lp.payment_amount),
        payment_date: lp.payment_date,
        method: lp.method,
      };
    }
  }

  const todayYmd = dayInShopTz(new Date());
  const billsMap = new Map();
  const machinesMap = new Map();

  for (const r of rows) {
    const invId = Number(r.invoice_id);
    if (!billsMap.has(invId)) {
      const issuedYmd = r.issued_date ? dayInShopTz(new Date(r.issued_date)) : todayYmd;
      const ageDays = Math.max(0, wholeDaysBetween(issuedYmd, todayYmd));
      billsMap.set(invId, {
        invoice_id: invId,
        issued_date: r.issued_date,
        status: r.status,
        id_card_status: Number(r.id_card_status || 0),
        live_total: round2(r.live_total),
        amount_paid: round2(r.amount_paid),
        owed: round2(Math.max(0, Number(r.owed || 0))),
        age_days: ageDays,
        age_bucket: ageBucketOf(ageDays),
      });
    }

    if (r.equipment_id && Number(r.units_out) > 0) {
      const eqId = Number(r.equipment_id);
      if (!machinesMap.has(eqId)) {
        machinesMap.set(eqId, {
          equipment_id: eqId,
          equipment_name: r.equipment_name,
          equipment_name_si: r.equipment_name_si || null,
          serial_number: r.serial_number || null,
          is_bulk_item: Boolean(r.is_bulk_item),
          image_url: r.image_url || null,
          category_id: r.category_id ? Number(r.category_id) : null,
          category_name: r.category_name || null,
          units_out: 0,
          invoice_ids: new Set(),
          oldest_due_date: null,
          daily_rate: round2(r.locked_extra_daily_rate),
        });
      }
      const m = machinesMap.get(eqId);
      m.units_out += Number(r.units_out);
      m.invoice_ids.add(invId);
      if (r.expected_return_date) {
        if (!m.oldest_due_date || String(r.expected_return_date) < String(m.oldest_due_date)) {
          m.oldest_due_date = r.expected_return_date;
        }
      }
    }
  }

  const billsBar = [...billsMap.values()];
  const totalOwedCents = billsBar.reduce((s, b) => s + toCents(b.owed), 0);
  const idCardsHeldCount = billsBar.filter((b) => b.id_card_status === 1).length;
  const oldestUnpaid = billsBar.find((b) => b.owed > BALANCE_TOLERANCE) || billsBar[0] || null;

  const machinesBar = [...machinesMap.values()].map((m) => ({
    equipment_id: m.equipment_id,
    equipment_name: m.equipment_name,
    equipment_name_si: m.equipment_name_si,
    serial_number: m.serial_number,
    is_bulk_item: m.is_bulk_item,
    image_url: m.image_url,
    category_id: m.category_id,
    category_name: m.category_name,
    units_out: m.units_out,
    bills_count: m.invoice_ids.size,
    invoice_ids: [...m.invoice_ids],
    oldest_due_date: m.oldest_due_date,
    daily_rate: m.daily_rate,
  }));

  const machinesOutCount = machinesBar.reduce((s, m) => s + m.units_out, 0);

  return {
    customer: {
      customer_id: customer.customer_id,
      name: formatCustomerName(customer),
      first_name: customer.first_name,
      last_name: customer.last_name,
      company_name: customer.company_name,
      customer_type: customer.customer_type,
      phone_number: customer.phone_number,
      nic_number: customer.nic_number,
      deposit_balance: round2(customer.deposit_balance),
      is_id_retained_currently: Boolean(customer.is_id_retained_currently),
      rating: customer.rating,
      status: customer.status,
    },
    summary: {
      total_owed: fromCents(totalOwedCents),
      open_bills_count: billsBar.length,
      machines_out_count: machinesOutCount,
      oldest_unpaid_bill_date: oldestUnpaid?.issued_date || null,
      id_cards_held_count: idCardsHeldCount,
      last_payment: lastPayment,
    },
    bills_bar: billsBar,
    machines_bar: machinesBar,
  };
};

/**
 * 2. GET /api/customers/:id/open-bills
 * Paginated (30/page) filtered & sorted bill cards for Step 2, fast for 2,000+ bills.
 */
export const getCustomerOpenBills = async (models, customerId, query = {}) => {
  const cid = Number(customerId);
  if (!Number.isInteger(cid) || cid <= 0) {
    throw new AppError("Invalid customer id.", 400);
  }

  const filter = String(query.filter || "payment_due");
  const sort = String(query.sort || "oldest");
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 30));
  const offset = (page - 1) * limit;

  const whereParts = ["i.is_deleted = 0", "i.customer_id = :customerId"];
  const replacements = { customerId: cid, limit, offset };

  if (filter === "completed") {
    whereParts.push("i.status = 'Completed'");
  } else {
    whereParts.push(`i.status IN ${OPEN_INVOICE_STATUSES_SQL}`);
    if (filter === "payment_due") {
      whereParts.push(`${owedExpr("i", "p.total_paid")} > 0.005`);
    } else if (filter === "machines_out") {
      whereParts.push(
        `EXISTS (SELECT 1 FROM INVOICE_LINES ilf WHERE ilf.invoice_id = i.invoice_id AND ${lineStillOutSql("ilf")})`,
      );
    } else if (filter === "all_back") {
      whereParts.push(
        `NOT EXISTS (SELECT 1 FROM INVOICE_LINES ilf WHERE ilf.invoice_id = i.invoice_id AND ${lineStillOutSql("ilf")})`,
      );
    }
  }

  // Date preset / custom
  const now = new Date();
  const todayYmd = dayInShopTz(now);
  let fromYmd = query.from ? String(query.from).slice(0, 10) : null;
  let toYmd = query.to ? String(query.to).slice(0, 10) : null;
  const preset = query.date_preset;
  if (preset === "this_month") {
    fromYmd = `${todayYmd.slice(0, 7)}-01`;
    toYmd = todayYmd;
  } else if (preset === "last_3_months") {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 3);
    fromYmd = dayInShopTz(d);
    toYmd = todayYmd;
  } else if (preset === "this_year") {
    fromYmd = `${todayYmd.slice(0, 4)}-01-01`;
    toYmd = todayYmd;
  }
  if (fromYmd) {
    whereParts.push("i.issued_date >= :fromDt");
    replacements.fromDt = `${fromYmd} 00:00:00`;
  }
  if (toYmd) {
    whereParts.push("i.issued_date <= :toDt");
    replacements.toDt = `${toYmd} 23:59:59`;
  }

  if (query.equipment_id) {
    whereParts.push(
      "EXISTS (SELECT 1 FROM INVOICE_LINES ile WHERE ile.invoice_id = i.invoice_id AND ile.equipment_id = :equipmentId)",
    );
    replacements.equipmentId = Number(query.equipment_id);
  }
  if (query.category_id) {
    whereParts.push(
      "EXISTS (SELECT 1 FROM INVOICE_LINES ilc INNER JOIN EQUIPMENT ec ON ec.equipment_id = ilc.equipment_id WHERE ilc.invoice_id = i.invoice_id AND ec.category_id = :categoryId)",
    );
    replacements.categoryId = Number(query.category_id);
  }

  const whereSql = whereParts.join(" AND ");

  let orderSql = "i.issued_date ASC, i.invoice_id ASC";
  if (sort === "biggest_balance") {
    orderSql = `owed DESC, i.issued_date ASC, i.invoice_id ASC`;
  } else if (sort === "newest") {
    orderSql = "i.issued_date DESC, i.invoice_id DESC";
  }

  const [countRow] = await models.sequelize.query(
    `SELECT COUNT(*) AS total
     FROM INVOICES i
     LEFT JOIN ${PAID_PER_INVOICE_SQL} p ON p.invoice_id = i.invoice_id
     WHERE ${whereSql}`,
    { replacements, type: QueryTypes.SELECT },
  );
  const total = Number(countRow?.total || 0);

  const invoiceRows = await models.sequelize.query(
    `SELECT
       i.invoice_id,
       i.issued_date,
       i.status,
       i.total_amount AS billed_total_amount,
       i.accrued_charges,
       i.discount_amount,
       i.transport_fee,
       i.id_card_status,
       i.borrowed_on_behalf_of_customer_id,
       ${liveTotalExpr("i")} AS live_total,
       COALESCE(p.total_paid, 0) AS amount_paid,
       ${owedExpr("i", "p.total_paid")} AS owed
     FROM INVOICES i
     LEFT JOIN ${PAID_PER_INVOICE_SQL} p ON p.invoice_id = i.invoice_id
     WHERE ${whereSql}
     ORDER BY ${orderSql}
     LIMIT :limit OFFSET :offset`,
    { replacements, type: QueryTypes.SELECT },
  );

  const pageIds = invoiceRows.map((r) => Number(r.invoice_id));
  const linesByInvoice = new Map();

  if (pageIds.length > 0) {
    const lines = await models.sequelize.query(
      `SELECT
         il.line_id,
         il.invoice_id,
         il.equipment_id,
         il.borrow_quantity,
         il.good_returned_qty,
         il.defective_returned_qty,
         il.line_status,
         il.expected_return_date,
         il.locked_extra_daily_rate,
         il.track_overdue,
         ${unitsOutExpr("il")} AS units_out,
         e.equipment_name,
         e.equipment_name_si,
         e.serial_number,
         e.image_url
       FROM INVOICE_LINES il
       LEFT JOIN EQUIPMENT e ON e.equipment_id = il.equipment_id
       WHERE il.invoice_id IN (:pageIds)
       ORDER BY il.line_id ASC`,
      { replacements: { pageIds }, type: QueryTypes.SELECT },
    );
    for (const l of lines) {
      const invId = Number(l.invoice_id);
      if (!linesByInvoice.has(invId)) linesByInvoice.set(invId, []);
      linesByInvoice.get(invId).push(l);
    }
  }

  const bills = invoiceRows.map((r) => {
    const invId = Number(r.invoice_id);
    const invLines = linesByInvoice.get(invId) || [];
    const equipMap = new Map();
    let growingPerDay = 0;
    let machinesOutTotal = 0;

    for (const l of invLines) {
      const uOut = Number(l.units_out || 0);
      machinesOutTotal += uOut;
      if (uOut > 0 && l.line_status === "Active") {
        growingPerDay += Number(l.locked_extra_daily_rate || 0) * uOut;
      }
      const eqId = Number(l.equipment_id);
      if (!equipMap.has(eqId)) {
        equipMap.set(eqId, {
          equipment_id: eqId,
          equipment_name: l.equipment_name,
          equipment_name_si: l.equipment_name_si || null,
          serial_number: l.serial_number || null,
          image_url: l.image_url || null,
          borrow_quantity: 0,
          returned_qty: 0,
          units_out: 0,
          fully_back: true,
        });
      }
      const entry = equipMap.get(eqId);
      entry.borrow_quantity += Number(l.borrow_quantity || 0);
      entry.returned_qty += Number(l.good_returned_qty || 0) + Number(l.defective_returned_qty || 0);
      entry.units_out += uOut;
      entry.fully_back = entry.units_out === 0;
    }

    const issuedYmd = r.issued_date ? dayInShopTz(new Date(r.issued_date)) : todayYmd;
    const ageDays = Math.max(0, wholeDaysBetween(issuedYmd, todayYmd));

    return {
      invoice_id: invId,
      issued_date: r.issued_date,
      status: r.status,
      age_days: ageDays,
      age_bucket: ageBucketOf(ageDays),
      live_total: round2(r.live_total),
      billed_total_amount: round2(r.billed_total_amount),
      accrued_charges: round2(r.accrued_charges),
      discount_amount: round2(r.discount_amount),
      amount_paid: round2(r.amount_paid),
      balance: round2(Math.max(0, Number(r.owed || 0))),
      growing_per_day: round2(growingPerDay),
      machines_out_count: machinesOutTotal,
      machine_counts: [...equipMap.values()],
      id_card_status: Number(r.id_card_status || 0),
      on_behalf_of_customer_id: r.borrowed_on_behalf_of_customer_id || null,
    };
  });

  return {
    bills,
    total,
    page,
    limit,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  };
};

// ── Return placement helpers ──────────────────────────────────────────────────

const perUnitReturnCharge = (line, invoiceIssuedDate, actualReturnDate, actualReturnYmd) => {
  const overdueEnabled = line.track_overdue !== false && line.track_overdue !== 0 && line.track_overdue !== "0";
  const openEnded = isOpenEndedLine(line);
  const extraDays = openEnded
    ? openEndedExtraDays(line, lineOutMoment(line, invoiceIssuedDate), actualReturnDate)
    : overdueEnabled
      ? chargeableLateDays(line, actualReturnYmd)
      : 0;
  return extraDays > 0 ? extraDays * Number(line.locked_extra_daily_rate || 0) : 0;
};

const placeReturnsAcrossBills = ({
  returns = [],
  invoices,
  splitRule,
  actualReturnDate,
  actualReturnYmd,
}) => {
  // Map invoice_id -> invoice, line_id -> { invoice, line, remaining }
  const invMap = new Map(invoices.map((inv) => [Number(inv.invoice_id), inv]));
  const lineInfoMap = new Map();
  const linesByEquip = new Map();

  for (const inv of invoices) {
    for (const line of inv.InvoiceLines || []) {
      const already = (Number(line.good_returned_qty) || 0) + (Number(line.defective_returned_qty) || 0);
      const remaining = Math.max(0, Number(line.borrow_quantity || 0) - already);
      const info = { invoice: inv, line, remaining };
      lineInfoMap.set(Number(line.line_id), info);
      if (remaining > 0 && line.line_status === "Active") {
        const eqId = Number(line.equipment_id);
        if (!linesByEquip.has(eqId)) linesByEquip.set(eqId, []);
        linesByEquip.get(eqId).push(info);
      }
    }
  }

  // invoice_id -> Map<line_id, { line_id, equipment_id, good_qty, defective_qty }>
  const placedByInvoice = new Map();
  const addPlacement = (invId, lineId, eqId, goodQty, badQty) => {
    if (goodQty + badQty <= 0) return;
    if (!placedByInvoice.has(invId)) placedByInvoice.set(invId, new Map());
    const invLines = placedByInvoice.get(invId);
    const prev = invLines.get(lineId) || { line_id: lineId, equipment_id: eqId, good_qty: 0, defective_qty: 0 };
    prev.good_qty += goodQty;
    prev.defective_qty += badQty;
    invLines.set(lineId, prev);
  };

  let hasSplittableEquipment = false;

  for (const item of returns) {
    const eqId = Number(item.equipment_id);
    const totalQty = parseInt(item.qty, 10) || 0;
    const damagedQty = parseInt(item.damaged_qty, 10) || 0;
    if (totalQty < 0 || damagedQty < 0 || damagedQty > totalQty) {
      throw new AppError(`Invalid return quantities for equipment ${eqId}.`, 400);
    }
    if (totalQty === 0) continue;

    if (Array.isArray(item.placement) && item.placement.length > 0) {
      let sumQty = 0;
      let sumBad = 0;
      for (const p of item.placement) {
        const lid = Number(p.invoice_line_id ?? p.line_id);
        const pq = parseInt(p.qty, 10) || 0;
        const pb = parseInt(p.damaged_qty, 10) || 0;
        if (pq < 0 || pb < 0 || pb > pq) {
          throw new AppError(`Invalid manual placement quantities on line ${lid}.`, 400);
        }
        const info = lineInfoMap.get(lid);
        if (!info || Number(info.line.equipment_id) !== eqId) {
          throw new AppError(`Line ${lid} does not match equipment ${eqId} on the selected bills.`, 400);
        }
        if (pq > info.remaining) {
          throw new AppError(`Line ${lid} only has ${info.remaining} unit(s) out.`, 400);
        }
        sumQty += pq;
        sumBad += pb;
        addPlacement(Number(info.invoice.invoice_id), lid, eqId, pq - pb, pb);
      }
      if (sumQty !== totalQty || sumBad !== damagedQty) {
        throw new AppError(`Manual placement for equipment ${eqId} must sum to ${totalQty} total and ${damagedQty} damaged.`, 400);
      }
      continue;
    }

    const candidates = [...(linesByEquip.get(eqId) || [])];
    const totalAvailable = candidates.reduce((s, c) => s + c.remaining, 0);
    if (totalQty > totalAvailable) {
      throw new AppError(
        `Equipment ${eqId} only has ${totalAvailable} unit(s) out on the selected bills (requested ${totalQty}).`,
        400,
      );
    }

    // Serial-numbered single machines (non-bulk, total_owned_qty === 1) never split across lines
    const eqMeta = candidates[0]?.line?.Equipment;
    const isSerialSingle =
      Boolean(eqMeta?.serial_number) &&
      !eqMeta?.is_bulk_item &&
      Number(eqMeta?.total_owned_qty || 1) === 1;
    if (isSerialSingle && totalQty > 1) {
      throw new AppError(`Serial-numbered equipment ${eqId} cannot be split across multiple units.`, 400);
    }
    if (!isSerialSingle && candidates.length > 1) {
      hasSplittableEquipment = true;
    }

    if (splitRule === "cheaper_for_customer") {
      candidates.sort((a, b) => {
        const ca = perUnitReturnCharge(a.line, a.invoice.issued_date, actualReturnDate, actualReturnYmd);
        const cb = perUnitReturnCharge(b.line, b.invoice.issued_date, actualReturnDate, actualReturnYmd);
        if (ca !== cb) return ca - cb;
        const da = new Date(a.invoice.issued_date || 0).getTime();
        const db = new Date(b.invoice.issued_date || 0).getTime();
        if (da !== db) return da - db;
        return Number(a.line.line_id) - Number(b.line.line_id);
      });
    } else {
      // oldest_first: oldest bill first, overdue lines before others
      candidates.sort((a, b) => {
        const da = new Date(a.invoice.issued_date || 0).getTime();
        const db = new Date(b.invoice.issued_date || 0).getTime();
        if (da !== db) return da - db;
        if (Number(a.invoice.invoice_id) !== Number(b.invoice.invoice_id)) {
          return Number(a.invoice.invoice_id) - Number(b.invoice.invoice_id);
        }
        const ovA =
          a.line.track_overdue !== false &&
          a.line.expected_return_date &&
          String(a.line.expected_return_date) < actualReturnYmd
            ? 0
            : 1;
        const ovB =
          b.line.track_overdue !== false &&
          b.line.expected_return_date &&
          String(b.line.expected_return_date) < actualReturnYmd
            ? 0
            : 1;
        if (ovA !== ovB) return ovA - ovB;
        const expA = String(a.line.expected_return_date || "9999-12-31");
        const expB = String(b.line.expected_return_date || "9999-12-31");
        if (expA !== expB) return expA.localeCompare(expB);
        return Number(a.line.line_id) - Number(b.line.line_id);
      });
    }

    let remQty = totalQty;
    let remBad = damagedQty;
    for (const c of candidates) {
      if (remQty <= 0) break;
      const take = Math.min(remQty, c.remaining);
      const takeBad = Math.min(remBad, take);
      const takeGood = take - takeBad;
      addPlacement(Number(c.invoice.invoice_id), Number(c.line.line_id), eqId, takeGood, takeBad);
      remQty -= take;
      remBad -= takeBad;
    }
  }

  return { placedByInvoice, hasSplittableEquipment, invMap };
};

const buildMachineCountsFromLines = (lines, lineOverridesMap = null) => {
  const byEq = new Map();
  let totalOut = 0;
  for (const l of lines) {
    const ov = lineOverridesMap?.get(Number(l.line_id));
    const good = ov ? ov.good_returned_qty : Number(l.good_returned_qty || 0);
    const bad = ov ? ov.defective_returned_qty : Number(l.defective_returned_qty || 0);
    const out = Math.max(0, Number(l.borrow_quantity || 0) - good - bad);
    totalOut += out;
    const eqId = Number(l.equipment_id);
    if (!byEq.has(eqId)) {
      byEq.set(eqId, {
        equipment_id: eqId,
        equipment_name: l.Equipment?.equipment_name || `Equipment #${eqId}`,
        equipment_name_si: l.Equipment?.equipment_name_si || null,
        serial_number: l.Equipment?.serial_number || null,
        units_out: 0,
      });
    }
    byEq.get(eqId).units_out += out;
  }
  return { totalOut, byType: [...byEq.values()] };
};

/**
 * 3. POST /api/customers/:id/settlement/preview
 * Computes exact before/after per bill, totals, plain-words summary (en/si),
 * cheaper_for_customer alternative, and preview_version. Writes NOTHING.
 */
export const previewSettlement = async (
  models,
  customerId,
  payload = {},
  { userId = null, now = new Date(), lockedData = null } = {},
) => {
  const cid = Number(customerId);
  if (!Number.isInteger(cid) || cid <= 0) {
    throw new AppError("Invalid customer id.", 400);
  }

  const t = lockedData?.transaction || null;
  const customer =
    lockedData?.customer ||
    (await models.Customer.findByPk(cid, { ...(t ? { transaction: t } : {}) }));
  if (!customer || customer.customer_delete_status) {
    throw new AppError("Customer not found.", 404);
  }

  const requestedIds = Array.isArray(payload.invoice_ids)
    ? [...new Set(payload.invoice_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : [];

  let invoices = lockedData?.invoices;
  if (!invoices) {
    const where = {
      customer_id: cid,
      is_deleted: false,
      status: { [Op.in]: ["Active", "PendingPayment"] },
    };
    if (requestedIds.length > 0) {
      where.invoice_id = { [Op.in]: requestedIds };
    }
    invoices = await models.Invoice.findAll({
      where,
      include: [
        {
          model: models.InvoiceLine,
          required: false,
          include: models.Equipment ? [{ model: models.Equipment, required: false }] : [],
        },
      ],
      order: [["invoice_id", "ASC"]],
      ...(t ? { transaction: t } : {}),
    });
  }

  if (requestedIds.length > 0) {
    const foundSet = new Set(invoices.map((i) => Number(i.invoice_id)));
    const missing = requestedIds.filter((id) => !foundSet.has(id));
    if (missing.length > 0) {
      throw new AppError(
        `Invoice(s) ${missing.join(", ")} are not open for this customer (may be completed or deleted).`,
        400,
      );
    }
  }

  if (invoices.length > MAX_BILLS_PER_SETTLEMENT) {
    throw new AppError(
      `A settlement can include at most ${MAX_BILLS_PER_SETTLEMENT} bills (got ${invoices.length}). Split into two settlements.`,
      400,
    );
  }
  const totalLineCount = invoices.reduce((s, inv) => s + (inv.InvoiceLines?.length || 0), 0);
  if (totalLineCount > MAX_LINES_PER_SETTLEMENT) {
    throw new AppError(
      `A settlement can include at most ${MAX_LINES_PER_SETTLEMENT} machine lines (got ${totalLineCount}). Split into two settlements.`,
      400,
    );
  }

  // Load net payments per invoice
  let paidMap = lockedData?.paidMap;
  if (!paidMap) {
    paidMap = new Map();
    const invIds = invoices.map((i) => Number(i.invoice_id));
    if (invIds.length > 0) {
      const payRows = await models.Payment.findAll({
        where: { invoice_id: { [Op.in]: invIds }, is_voided: false },
        attributes: ["invoice_id", "payment_amount"],
        ...(t ? { transaction: t } : {}),
      });
      for (const p of payRows) {
        const id = Number(p.invoice_id);
        paidMap.set(id, round2((paidMap.get(id) || 0) + Number(p.payment_amount || 0)));
      }
    }
  }

  // Validate dates & reasons
  const actualReturnDate = resolvePastOrToday(payload.return_date, "return date", now);
  const actualReturnYmd = dayInShopTz(actualReturnDate);
  const todayYmd = dayInShopTz(now);
  const returnDaysBack = Math.max(0, wholeDaysBetween(actualReturnYmd, todayYmd));

  let validatedReturnDateReason = null;
  const returnsInput = Array.isArray(payload.returns) ? payload.returns : [];
  const hasAnyReturn = returnsInput.some((r) => (parseInt(r.qty, 10) || 0) > 0);
  if (hasAnyReturn && returnDaysBack > 0) {
    validatedReturnDateReason = await validateReason(models, "backdate", payload.date_reason, { transaction: t });
  }

  const splitRule =
    payload.split_rule === "cheaper_for_customer" ? "cheaper_for_customer" : "oldest_first";

  const paymentsInput = Array.isArray(payload.payments) ? payload.payments : [];
  const normalizedPayments = [];
  for (const p of paymentsInput) {
    const amt = round2(Number(p.amount || 0));
    if (amt <= 0) continue;
    if (["wallet", "walletdeposit"].includes(String(p.method || "").toLowerCase())) {
      throw new AppError("Use the wallet credit option to pay from the customer's wallet, not a payment method.", 400);
    }
    const pDate = resolvePastOrToday(p.payment_date, "payment date", now);
    const pYmd = dayInShopTz(pDate);
    const pDaysBack = Math.max(0, wholeDaysBetween(pYmd, todayYmd));
    let pDateReason = null;
    if (pDaysBack > 0) {
      pDateReason = await validateReason(models, "backdate", p.date_reason || payload.date_reason, {
        transaction: t,
      });
    }
    normalizedPayments.push({
      amount: amt,
      method: String(p.method || "Cash"),
      payment_date: pDate,
      payment_ymd: pYmd,
      days_back: pDaysBack,
      date_reason: pDateReason,
    });
  }

  const useWalletAmount = round2(Math.max(0, Number(payload.use_wallet_amount || 0)));
  if (useWalletAmount > round2(customer.deposit_balance) + BALANCE_TOLERANCE) {
    throw new AppError(
      `Requested wallet credit Rs.${useWalletAmount} exceeds customer balance Rs.${round2(customer.deposit_balance)}.`,
      400,
    );
  }

  const leftoverMode = ["credit", "change", "none"].includes(payload.leftover_mode)
    ? payload.leftover_mode
    : "credit";

  // Validate discounts
  const discountsInput = Array.isArray(payload.discounts) ? payload.discounts : [];
  const discountByInvoice = new Map();
  for (const d of discountsInput) {
    const invId = Number(d.invoice_id);
    const inv = invoices.find((i) => Number(i.invoice_id) === invId);
    if (!inv) {
      throw new AppError(`Discount invoice ${d.invoice_id} is not in this settlement.`, 400);
    }
    let added = 0;
    if (d.amount !== undefined && d.amount !== null) {
      added = round2(Number(d.amount));
    } else if (d.pct !== undefined && d.pct !== null) {
      const base = Number(inv.total_amount || 0) + Number(inv.discount_amount || 0);
      added = round2((base * Number(d.pct)) / 100);
    }
    if (!Number.isFinite(added) || added < 0) {
      throw new AppError("Discount amount cannot be negative.", 400);
    }
    if (added > 0) {
      const reason = await validateReason(models, "discount", d.reason || d.discount_reason, {
        transaction: t,
      });
      discountByInvoice.set(invId, { added, reason });
    }
  }

  // Place returns according to splitRule
  const { placedByInvoice, hasSplittableEquipment } = placeReturnsAcrossBills({
    returns: returnsInput,
    invoices,
    splitRule,
    actualReturnDate,
    actualReturnYmd,
  });

  // Run dry-run return math per bill
  const dryReturnByInvoice = new Map();
  let chosenTotalLateFees = 0;
  for (const inv of invoices) {
    const invId = Number(inv.invoice_id);
    const placedMap = placedByInvoice.get(invId);
    if (!placedMap || placedMap.size === 0) continue;

    const linesReturned = [...placedMap.values()];
    const res = await executeReturnOnInvoice(
      models,
      { invoice_id: invId, lines_returned: linesReturned },
      userId,
      {
        transaction: t,
        dryRun: true,
        now,
        actualReturnDate,
        actualReturnYmd,
        todayYmd,
        returnDaysBack,
        validatedDateReason: validatedReturnDateReason,
        preloadedInvoice: inv,
        preloadedTotalPaid: paidMap.get(invId) || 0,
      },
    );
    dryReturnByInvoice.set(invId, res);
    chosenTotalLateFees = round2(chosenTotalLateFees + res.totalLateFees);
  }

  // Compute cheaper_for_customer alternative if oldest_first and splittable
  let cheaperAlternative = { available: false, saving: 0, total_late_fees: chosenTotalLateFees };
  if (hasAnyReturn && hasSplittableEquipment) {
    const altRule = splitRule === "oldest_first" ? "cheaper_for_customer" : "oldest_first";
    const altPlaced = placeReturnsAcrossBills({
      returns: returnsInput,
      invoices,
      splitRule: altRule,
      actualReturnDate,
      actualReturnYmd,
    });
    let altLateFees = 0;
    for (const inv of invoices) {
      const invId = Number(inv.invoice_id);
      const placedMap = altPlaced.placedByInvoice.get(invId);
      if (!placedMap || placedMap.size === 0) continue;
      const res = await executeReturnOnInvoice(
        models,
        { invoice_id: invId, lines_returned: [...placedMap.values()] },
        userId,
        {
          transaction: t,
          dryRun: true,
          now,
          actualReturnDate,
          actualReturnYmd,
          todayYmd,
          returnDaysBack,
          preloadedInvoice: inv,
          preloadedTotalPaid: paidMap.get(invId) || 0,
        },
      );
      altLateFees = round2(altLateFees + res.totalLateFees);
    }
    if (splitRule === "oldest_first") {
      const saving = round2(chosenTotalLateFees - altLateFees);
      if (saving > 0.005) {
        cheaperAlternative = { available: true, saving, total_late_fees: altLateFees };
      }
    } else {
      const saving = round2(altLateFees - chosenTotalLateFees);
      if (saving > 0.005) {
        cheaperAlternative = { available: true, saving, total_late_fees: chosenTotalLateFees };
      }
    }
  }

  // Compute post-return + post-discount state per bill before payment sharing
  const workingBills = invoices.map((inv) => {
    const invId = Number(inv.invoice_id);
    const beforePaid = round2(paidMap.get(invId) || 0);
    const beforeBilledTotal = round2(inv.total_amount);
    const beforeAccrued = round2(inv.accrued_charges);
    const beforeLiveTotal = round2(beforeBilledTotal + beforeAccrued);
    const beforeBalance = round2(Math.max(0, beforeLiveTotal - beforePaid));
    const beforeMachines = buildMachineCountsFromLines(inv.InvoiceLines || []);

    const dryRet = dryReturnByInvoice.get(invId) || null;
    const afterBilledPreDiscount = dryRet ? dryRet.newGrandTotal : beforeBilledTotal;
    const afterAccrued = dryRet ? dryRet.afterAccruedCharges : beforeAccrued;
    const afterMachines = dryRet
      ? buildMachineCountsFromLines(inv.InvoiceLines || [], dryRet.updatedLineOverrides)
      : beforeMachines;

    const disc = discountByInvoice.get(invId) || null;
    const discountAdded = disc ? disc.added : 0;
    const afterBilledTotal = round2(afterBilledPreDiscount - discountAdded);
    if (afterBilledTotal < 0) {
      throw new AppError(`Discount on INV-${invId} exceeds the bill total.`, 400);
    }
    const afterLiveTotal = round2(afterBilledTotal + afterAccrued);
    const balanceBeforePayment = round2(Math.max(0, afterLiveTotal - beforePaid));
    const statusAfterReturn = dryRet ? dryRet.finalStatus : inv.status;
    const hadReturns = Boolean(dryRet && dryRet.totalReturnedQty > 0);
    const nowFullyBack = hadReturns && afterMachines.totalOut === 0;
    const alreadyFullyBack = !hadReturns && afterMachines.totalOut === 0;

    return {
      inv,
      invId,
      beforePaid,
      beforeBilledTotal,
      beforeAccrued,
      beforeLiveTotal,
      beforeBalance,
      beforeDiscount: round2(inv.discount_amount),
      beforeMachines,
      dryRet,
      discountAdded,
      discountReason: disc?.reason || null,
      afterBilledTotal,
      afterAccrued,
      afterLiveTotal,
      balanceBeforePayment,
      statusAfterReturn,
      nowFullyBack,
      alreadyFullyBack,
      afterMachines,
      paymentApplied: 0,
      paymentAllocations: [],
    };
  });

  // Sort workingBills into payment queue order
  const queueOverride = Array.isArray(payload.queue_order)
    ? payload.queue_order.map(Number)
    : [];
  const queueRank = new Map(queueOverride.map((id, idx) => [id, idx]));

  const orderedForPayment = [...workingBills].sort((a, b) => {
    const ra = queueRank.has(a.invId) ? queueRank.get(a.invId) : Number.MAX_SAFE_INTEGER;
    const rb = queueRank.has(b.invId) ? queueRank.get(b.invId) : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;

    const tier = (w) => (w.nowFullyBack ? 0 : w.alreadyFullyBack ? 1 : 2);
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;

    const da = new Date(a.inv.issued_date || 0).getTime();
    const db = new Date(b.inv.issued_date || 0).getTime();
    if (da !== db) return da - db;
    return a.invId - b.invId;
  });

  // Total payment pool (cash/card/transfer/cheque + wallet credit)
  const cashMethodsTotalCents = normalizedPayments.reduce((s, p) => s + toCents(p.amount), 0);
  const walletCents = toCents(useWalletAmount);
  const totalPoolCents = cashMethodsTotalCents + walletCents;

  // Per-bill amount overrides (never above bill balance or remaining pool)
  const billAmountsRaw = payload.bill_amounts;
  const overrideMap = new Map();
  if (Array.isArray(billAmountsRaw)) {
    for (const item of billAmountsRaw) {
      if (item?.invoice_id) overrideMap.set(Number(item.invoice_id), Math.max(0, Number(item.amount || 0)));
    }
  } else if (billAmountsRaw && typeof billAmountsRaw === "object") {
    for (const [k, v] of Object.entries(billAmountsRaw)) {
      overrideMap.set(Number(k), Math.max(0, Number(v || 0)));
    }
  }

  let remainingPoolCents = totalPoolCents;
  const targetCentsByBill = new Map();

  // First pass: honour explicit bill_amounts overrides
  for (const w of orderedForPayment) {
    if (!overrideMap.has(w.invId)) continue;
    const reqCents = toCents(overrideMap.get(w.invId));
    const balCents = toCents(w.balanceBeforePayment);
    const alloc = Math.min(reqCents, balCents, remainingPoolCents);
    targetCentsByBill.set(w.invId, alloc);
    remainingPoolCents -= alloc;
  }

  // Second pass: share remaining pool in queue order
  for (const w of orderedForPayment) {
    if (remainingPoolCents <= 0) break;
    if (overrideMap.has(w.invId)) continue;
    const balCents = toCents(w.balanceBeforePayment);
    const alloc = Math.min(balCents, remainingPoolCents);
    if (alloc > 0) {
      targetCentsByBill.set(w.invId, alloc);
      remainingPoolCents -= alloc;
    }
  }

  // Allocate individual payment methods + wallet across bills sequentially
  const paymentSources = [
    ...normalizedPayments.map((p) => ({ ...p, remCents: toCents(p.amount), isWallet: false })),
    ...(walletCents > 0
      ? [{ amount: fromCents(walletCents), method: "WalletDeposit", payment_date: now, payment_ymd: todayYmd, days_back: 0, date_reason: null, remCents: walletCents, isWallet: true }]
      : []),
  ];

  let srcIdx = 0;
  for (const w of orderedForPayment) {
    let needCents = targetCentsByBill.get(w.invId) || 0;
    w.paymentApplied = fromCents(needCents);
    while (needCents > 0 && srcIdx < paymentSources.length) {
      const src = paymentSources[srcIdx];
      if (src.remCents <= 0) {
        srcIdx++;
        continue;
      }
      const take = Math.min(needCents, src.remCents);
      w.paymentAllocations.push({
        amount: fromCents(take),
        method: src.method,
        payment_date: src.payment_date,
        payment_ymd: src.payment_ymd,
        days_back: src.days_back,
        date_reason: src.date_reason,
        is_wallet: src.isWallet,
      });
      src.remCents -= take;
      needCents -= take;
      if (src.remCents <= 0) srcIdx++;
    }
  }

  const leftoverAmount = fromCents(remainingPoolCents);

  // Build response bills
  const queuePositionMap = new Map(orderedForPayment.map((w, idx) => [w.invId, idx + 1]));
  const billsOut = orderedForPayment.map((w) => {
    const afterPaid = round2(w.beforePaid + w.paymentApplied);
    const afterBalance = round2(Math.max(0, w.afterLiveTotal - afterPaid));
    const lateFeeAdded = w.dryRet ? w.dryRet.totalLateFees : 0;
    const rentalDaysAdded = w.dryRet ? w.dryRet.rentalDaysAdded : 0;
    const returnedQty = w.dryRet ? w.dryRet.totalReturnedQty : 0;
    const damagedQty = w.dryRet ? w.dryRet.totalDamagedQty : 0;
    const changed =
      returnedQty > 0 ||
      w.paymentApplied > 0 ||
      w.discountAdded > 0 ||
      lateFeeAdded > 0;

    return {
      invoice_id: w.invId,
      issued_date: w.inv.issued_date,
      queue_position: queuePositionMap.get(w.invId),
      changed,
      status_before: w.inv.status,
      status_after: w.statusAfterReturn,
      id_card_status: Number(w.inv.id_card_status || 0),
      before: {
        total_amount: w.beforeLiveTotal,
        billed_total_amount: w.beforeBilledTotal,
        accrued_charges: w.beforeAccrued,
        amount_paid: w.beforePaid,
        discount_amount: w.beforeDiscount,
        balance: w.beforeBalance,
        machines_out_count: w.beforeMachines.totalOut,
        machines_out_by_type: w.beforeMachines.byType,
      },
      after: {
        total_amount: w.afterLiveTotal,
        billed_total_amount: w.afterBilledTotal,
        accrued_charges: w.afterAccrued,
        amount_paid: afterPaid,
        discount_amount: round2(w.beforeDiscount + w.discountAdded),
        balance: afterBalance,
        machines_out_count: w.afterMachines.totalOut,
        machines_out_by_type: w.afterMachines.byType,
      },
      changes: {
        returned_qty: returnedQty,
        damaged_qty: damagedQty,
        late_fee_added: lateFeeAdded,
        rental_days_added: rentalDaysAdded,
        late_fee_difference: w.dryRet ? w.dryRet.lateFeeDifference : 0,
        payment_applied: w.paymentApplied,
        payment_allocations: w.paymentAllocations,
        discount_added: w.discountAdded,
        discount_reason: w.discountReason,
        lines: w.dryRet ? w.dryRet.lineResults : [],
      },
      stamps: {
        paid_off: afterBalance <= BALANCE_TOLERANCE,
        ready_to_close: afterBalance <= BALANCE_TOLERANCE && w.afterMachines.totalOut === 0,
      },
    };
  });

  const totals = {
    owed_before: fromCents(billsOut.reduce((s, b) => s + toCents(b.before.balance), 0)),
    owed_after: fromCents(billsOut.reduce((s, b) => s + toCents(b.after.balance), 0)),
    machines_out_before: billsOut.reduce((s, b) => s + b.before.machines_out_count, 0),
    machines_out_after: billsOut.reduce((s, b) => s + b.after.machines_out_count, 0),
    returned_qty: billsOut.reduce((s, b) => s + b.changes.returned_qty, 0),
    damaged_qty: billsOut.reduce((s, b) => s + b.changes.damaged_qty, 0),
    payment_total: fromCents(cashMethodsTotalCents),
    wallet_used: useWalletAmount,
    leftover_amount: leftoverAmount,
    leftover_mode: leftoverMode,
    total_late_fees: chosenTotalLateFees,
    total_discount: fromCents(billsOut.reduce((s, b) => s + toCents(b.changes.discount_added), 0)),
    affected_bills_count: billsOut.filter((b) => b.changed).length,
  };

  // Canonical hash for preview_version (detects any input change, balance change, or day change)
  const hashPayload = {
    customer_id: cid,
    today_ymd: todayYmd,
    return_ymd: actualReturnYmd,
    split_rule: splitRule,
    leftover_mode: leftoverMode,
    use_wallet_amount: useWalletAmount,
    payments: normalizedPayments.map((p) => [p.amount, p.method, p.payment_ymd]),
    returns_placed: billsOut.map((b) => [
      b.invoice_id,
      b.changes.lines.map((l) => [l.line_id, l.good_qty, l.defective_qty, l.line_late_fee]),
    ]),
    discounts: billsOut.map((b) => [b.invoice_id, b.changes.discount_added]),
    bill_amounts: billsOut.map((b) => [b.invoice_id, b.changes.payment_applied]),
    bills_state: invoices.map((inv) => [
      Number(inv.invoice_id),
      inv.status,
      round2(inv.total_amount),
      round2(inv.accrued_charges),
      round2(inv.discount_amount),
      round2(paidMap.get(Number(inv.invoice_id)) || 0),
      (inv.InvoiceLines || []).map((l) => [
        Number(l.line_id),
        Number(l.good_returned_qty || 0),
        Number(l.defective_returned_qty || 0),
        l.line_status,
      ]),
    ]),
  };
  const previewVersion = crypto
    .createHash("sha256")
    .update(JSON.stringify(hashPayload))
    .digest("hex");

  const summaryEnParts = [];
  const summarySiParts = [];
  if (totals.returned_qty > 0) {
    summaryEnParts.push(`${totals.returned_qty} machine(s) returned`);
    summarySiParts.push(`උපකරණ ${totals.returned_qty}ක් ආපසු ලැබුණි`);
  }
  if (totals.payment_total > 0 || totals.wallet_used > 0) {
    const paidSum = round2(totals.payment_total + totals.wallet_used);
    summaryEnParts.push(`Rs ${formatLkr(paidSum)} paid`);
    summarySiParts.push(`රු. ${formatLkr(paidSum)}ක් ගෙවන ලදී`);
  }
  if (totals.total_discount > 0) {
    summaryEnParts.push(`Rs ${formatLkr(totals.total_discount)} discount`);
    summarySiParts.push(`රු. ${formatLkr(totals.total_discount)}ක වට්ටමක්`);
  }
  summaryEnParts.push(`across ${totals.affected_bills_count} bill(s)`);
  summaryEnParts.push(`remaining balance Rs ${formatLkr(totals.owed_after)}`);
  summarySiParts.push(`බිල්පත් ${totals.affected_bills_count}ක් සඳහා`);
  summarySiParts.push(`ඉතිරි ශේෂය රු. ${formatLkr(totals.owed_after)}`);

  return {
    customer_id: cid,
    customer_name: formatCustomerName(customer),
    return_date: actualReturnYmd,
    split_rule: splitRule,
    cheaper_alternative: cheaperAlternative,
    totals,
    bills: billsOut,
    summary: {
      en: summaryEnParts.join(" · "),
      si: summarySiParts.join(" · "),
    },
    preview_version: previewVersion,
  };
};

export class SettlementChangedError extends AppError {
  constructor(preview) {
    super("The bills have changed since your preview. Please review the updated figures.", 409);
    this.code = "settlement_changed";
    this.preview = preview;
  }
}

/**
 * 4. POST /api/customers/:id/settlement
 * Locks involved bills and lines in fixed order inside ONE transaction, recomputes preview,
 * returns 409 settlement_changed if preview_version differs, else commits all mutations atomically.
 */
export const saveSettlement = async (models, customerId, payload = {}, userId, { now = new Date() } = {}) => {
  const cid = Number(customerId);
  if (!Number.isInteger(cid) || cid <= 0) {
    throw new AppError("Invalid customer id.", 400);
  }

  const requestedIds = Array.isArray(payload.invoice_ids)
    ? [...new Set(payload.invoice_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : [];

  return models.sequelize.transaction(async (t) => {
    const customer = await models.Customer.findByPk(cid, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!customer || customer.customer_delete_status) {
      throw new AppError("Customer not found.", 404);
    }

    const where = {
      customer_id: cid,
      is_deleted: false,
      status: { [Op.in]: ["Active", "PendingPayment"] },
    };
    if (requestedIds.length > 0) {
      where.invoice_id = { [Op.in]: requestedIds };
    }

    // Lock invoices in fixed ascending invoice_id order
    const invoices = await models.Invoice.findAll({
      where,
      order: [["invoice_id", "ASC"]],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    const invIds = invoices.map((i) => Number(i.invoice_id));
    if (invIds.length > MAX_BILLS_PER_SETTLEMENT) {
      throw new AppError(
        `A settlement can include at most ${MAX_BILLS_PER_SETTLEMENT} bills (got ${invIds.length}).`,
        400,
      );
    }

    // Lock all lines in fixed ascending line_id order
    const allLines =
      invIds.length > 0
        ? await models.InvoiceLine.findAll({
            where: { invoice_id: { [Op.in]: invIds } },
            include: models.Equipment ? [{ model: models.Equipment, required: false }] : [],
            order: [["line_id", "ASC"]],
            transaction: t,
            lock: t.LOCK.UPDATE,
          })
        : [];

    const linesByInv = new Map();
    for (const l of allLines) {
      const id = Number(l.invoice_id);
      if (!linesByInv.has(id)) linesByInv.set(id, []);
      linesByInv.get(id).push(l);
    }
    for (const inv of invoices) {
      inv.InvoiceLines = linesByInv.get(Number(inv.invoice_id)) || [];
    }

    const paidMap = new Map();
    if (invIds.length > 0) {
      const payRows = await models.Payment.findAll({
        where: { invoice_id: { [Op.in]: invIds }, is_voided: false },
        attributes: ["invoice_id", "payment_amount"],
        transaction: t,
      });
      for (const p of payRows) {
        const id = Number(p.invoice_id);
        paidMap.set(id, round2((paidMap.get(id) || 0) + Number(p.payment_amount || 0)));
      }
    }

    const preview = await previewSettlement(models, cid, payload, {
      userId,
      now,
      lockedData: { customer, invoices, paidMap, transaction: t },
    });

    if (payload.preview_version && payload.preview_version !== preview.preview_version) {
      throw new SettlementChangedError(preview);
    }

    const actualReturnDate = resolvePastOrToday(payload.return_date, "return date", now);
    const actualReturnYmd = dayInShopTz(actualReturnDate);
    const todayYmd = dayInShopTz(now);
    const returnDaysBack = Math.max(0, wholeDaysBetween(actualReturnYmd, todayYmd));
    let validatedReturnDateReason = null;
    if (preview.totals.returned_qty > 0 && returnDaysBack > 0) {
      validatedReturnDateReason = await validateReason(models, "backdate", payload.date_reason, {
        transaction: t,
      });
    }

    // 1. Create CUSTOMER_SETTLEMENTS row first
    const settlement = await models.CustomerSettlement.create(
      {
        customer_id: cid,
        settled_at: now,
        entered_at: now,
        user_id: userId,
        return_date: preview.totals.returned_qty > 0 ? actualReturnDate : null,
        payment_total: preview.totals.payment_total,
        leftover_mode: preview.totals.leftover_mode,
        leftover_amount: preview.totals.leftover_amount,
        wallet_used_amount: preview.totals.wallet_used,
        split_rule: preview.split_rule,
        note: payload.note ? String(payload.note).slice(0, 500) : null,
        is_voided: false,
        idempotency_key: payload.idempotency_key || null,
        snapshot_json: preview,
      },
      { transaction: t },
    );
    const settlementId = settlement.settlement_id;

    // 2. Apply returns per bill via executeReturnOnInvoice (real mode)
    const invMap = new Map(invoices.map((i) => [Number(i.invoice_id), i]));
    for (const bill of preview.bills) {
      if (bill.changes.lines.length > 0) {
        const linesReturned = bill.changes.lines.map((l) => ({
          line_id: l.line_id,
          good_qty: l.good_qty,
          defective_qty: l.defective_qty,
        }));
        await executeReturnOnInvoice(
          models,
          { invoice_id: bill.invoice_id, lines_returned: linesReturned },
          userId,
          {
            transaction: t,
            dryRun: false,
            now,
            actualReturnDate,
            actualReturnYmd,
            todayYmd,
            returnDaysBack,
            validatedDateReason: validatedReturnDateReason,
            settlementId,
            skipPayment: true,
            skipActivities: true,
          },
        );
      }

      // 3. Apply discount (updateInvoiceFees path)
      if (bill.changes.discount_added > 0 && bill.changes.discount_reason) {
        const inv = await models.Invoice.findByPk(bill.invoice_id, { transaction: t });
        const oldDiscount = Number(inv.discount_amount || 0);
        const newDiscount = round2(oldDiscount + bill.changes.discount_added);
        const newTotal = round2(Number(inv.total_amount || 0) - bill.changes.discount_added);
        const r = bill.changes.discount_reason;

        await inv.update(
          {
            discount_amount: newDiscount,
            total_amount: newTotal,
            discount_reason_key: r.key,
            discount_reason_note: r.note || null,
          },
          { transaction: t },
        );

        await models.InvoiceTrace.create(
          {
            invoice_id: bill.invoice_id,
            actor_user_id: userId,
            event_category: "FINANCE",
            event_action: "FEES_UPDATED",
            comments: `Settlement #${settlementId} discount: Rs.${bill.changes.discount_added} (${r.label_en}).`,
            state_payload: {
              settlement_id: settlementId,
              discount_amount: newDiscount,
              discount_reason: r,
            },
          },
          { transaction: t },
        );

        const printCount = models.InvoicePrintLog?.count
          ? await models.InvoicePrintLog.count({ where: { invoice_id: bill.invoice_id }, transaction: t })
          : 0;
        const raisedAfterPrinting = printCount > 0 && newDiscount > oldDiscount;
        const baseTotal = Number(inv.sub_total || 0) + Number(inv.transport_fee || 0);
        const discountPct = baseTotal > 0 ? Math.round((newDiscount / baseTotal) * 10000) / 100 : 0;
        await maybeRecordActivity(
          models,
          {
            type: "discount",
            invoice_id: bill.invoice_id,
            customer_id: cid,
            actor_user_id: userId,
            amount: bill.changes.discount_added,
            occurred_at: now,
            data: {
              settlement_id: settlementId,
              old_amount: oldDiscount,
              new_amount: newDiscount,
              discount_pct: discountPct,
              raised_after_printing: raisedAfterPrinting,
              reason_key: r.key,
              reason_note: r.note,
              reason_label_en: r.label_en,
              reason_label_si: r.label_si,
            },
          },
          { transaction: t },
        );
      }

      // 4. Apply payment allocations (normal PAYMENTS rows with settlement_id)
      for (const alloc of bill.changes.payment_allocations) {
        if (alloc.amount <= 0) continue;
        await models.Payment.create(
          {
            invoice_id: bill.invoice_id,
            payment_amount: alloc.amount,
            payment_date: alloc.payment_date,
            entered_at: now,
            method: alloc.method,
            received_by_user_id: userId,
            settlement_id: settlementId,
          },
          { transaction: t },
        );

        await models.InvoiceTrace.create(
          {
            invoice_id: bill.invoice_id,
            actor_user_id: userId,
            event_category: "FINANCE",
            event_action: "PAYMENT_RECEIVED",
            comments: `Settlement #${settlementId}: Payment of Rs.${alloc.amount} via ${alloc.method}.`,
            state_payload: { settlement_id: settlementId, method: alloc.method, amount: alloc.amount },
          },
          { transaction: t },
        );

        if (alloc.days_back > 0 && !alloc.is_wallet) {
          await maybeRecordActivity(
            models,
            {
              type: "backdated_payment",
              invoice_id: bill.invoice_id,
              customer_id: cid,
              actor_user_id: userId,
              amount: alloc.amount,
              occurred_at: now,
              data: {
                settlement_id: settlementId,
                days_back: alloc.days_back,
                payment_date: alloc.payment_ymd,
                method: alloc.method,
                reason_key: alloc.date_reason?.key || null,
                reason_note: alloc.date_reason?.note || null,
                reason_label_en: alloc.date_reason?.label_en || null,
                reason_label_si: alloc.date_reason?.label_si || null,
              },
            },
            { transaction: t },
          );
        }
      }
    }

    // 5. Wallet debit / credit
    let newDepositBalance = round2(customer.deposit_balance);
    if (preview.totals.wallet_used > 0) {
      newDepositBalance = round2(newDepositBalance - preview.totals.wallet_used);
    }
    if (preview.totals.leftover_mode === "credit" && preview.totals.leftover_amount > 0) {
      newDepositBalance = round2(newDepositBalance + preview.totals.leftover_amount);
    }
    if (newDepositBalance !== round2(customer.deposit_balance)) {
      await customer.update({ deposit_balance: newDepositBalance }, { transaction: t });
    }

    await touchCustomerBrief(models, cid, { transaction: t, now });

    // 6. Record customer_payment + backdated_return + cheaper_for_customer activities
    const changedBills = preview.bills.filter((b) => b.changed);
    await maybeRecordActivity(
      models,
      {
        type: "customer_payment",
        invoice_id: changedBills[0]?.invoice_id || invMap.keys().next().value || null,
        customer_id: cid,
        actor_user_id: userId,
        amount: round2(preview.totals.payment_total + preview.totals.wallet_used),
        occurred_at: now,
        data: {
          settlement_id: settlementId,
          returned_qty: preview.totals.returned_qty,
          damaged_qty: preview.totals.damaged_qty,
          payment_total: preview.totals.payment_total,
          wallet_used: preview.totals.wallet_used,
          leftover_amount: preview.totals.leftover_amount,
          leftover_mode: preview.totals.leftover_mode,
          split_rule: preview.split_rule,
          cheaper_saving:
            preview.split_rule === "cheaper_for_customer"
              ? preview.cheaper_alternative?.saving || 0
              : 0,
          bills_breakdown: changedBills.map((b) => ({
            invoice_id: b.invoice_id,
            returned_qty: b.changes.returned_qty,
            late_fee_added: b.changes.late_fee_added,
            payment_applied: b.changes.payment_applied,
            discount_added: b.changes.discount_added,
            balance_after: b.after.balance,
          })),
        },
      },
      { transaction: t },
    );

    if (preview.totals.returned_qty > 0 && returnDaysBack > 0) {
      await maybeRecordActivity(
        models,
        {
          type: "backdated_return",
          invoice_id: changedBills.find((b) => b.changes.returned_qty > 0)?.invoice_id || null,
          customer_id: cid,
          actor_user_id: userId,
          amount: preview.totals.total_late_fees,
          occurred_at: now,
          data: {
            settlement_id: settlementId,
            days_back: returnDaysBack,
            actual_return_date: actualReturnYmd,
            late_fee_difference: changedBills.reduce((s, b) => s + (b.changes.late_fee_difference || 0), 0),
            reason_key: validatedReturnDateReason?.key || null,
            reason_note: validatedReturnDateReason?.note || null,
            reason_label_en: validatedReturnDateReason?.label_en || null,
            reason_label_si: validatedReturnDateReason?.label_si || null,
          },
        },
        { transaction: t },
      );
    }

    if (preview.split_rule === "cheaper_for_customer" && (preview.cheaper_alternative?.saving || 0) > 0) {
      await maybeRecordActivity(
        models,
        {
          type: "system",
          invoice_id: changedBills[0]?.invoice_id || null,
          customer_id: cid,
          actor_user_id: userId,
          amount: preview.cheaper_alternative.saving,
          occurred_at: now,
          data: {
            settlement_id: settlementId,
            split_rule: "cheaper_for_customer",
            saving: preview.cheaper_alternative.saving,
            title: `Cheaper-for-customer split saved Rs ${formatLkr(preview.cheaper_alternative.saving)}`,
            title_si: `පාරිභෝගිකයාට ලාභදායී බෙදීමෙන් රු. ${formatLkr(preview.cheaper_alternative.saving)}ක් ඉතිරි විය`,
          },
        },
        { transaction: t },
      );
    }

    return {
      settlement_id: settlementId,
      settled_at: settlement.settled_at,
      ...preview,
    };
  });
};

/**
 * 5. POST /api/customers/:id/settlement/complete-bills
 * Completes paid-off, fully-back bills via completeInvoice.
 */
export const completeSettlementBills = async (
  models,
  customerId,
  { invoice_ids = [], release_id_card = false } = {},
  userId,
) => {
  const cid = Number(customerId);
  const ids = [...new Set((invoice_ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) {
    throw new AppError("Select at least one bill to complete.", 400);
  }

  const owned = await models.Invoice.findAll({
    where: { invoice_id: { [Op.in]: ids }, customer_id: cid, is_deleted: false },
    attributes: ["invoice_id"],
  });
  if (owned.length !== ids.length) {
    throw new AppError("One or more bills do not belong to this customer.", 400);
  }

  const completedIds = [];
  for (const invId of ids) {
    await completeInvoice(models, invId, { release_id_card }, userId);
    completedIds.push(invId);
  }

  return {
    completed_invoice_ids: completedIds,
    count: completedIds.length,
  };
};

/**
 * 6. POST /api/settlements/:id/void
 * Voids its payments and takes back its wallet credit (refused if credit was spent).
 * Returns are NOT undone (spec 9.1.5).
 */
export const voidSettlement = async (models, settlementId, userId, { reason = null, now = new Date() } = {}) => {
  const sid = Number(settlementId);
  if (!Number.isInteger(sid) || sid <= 0) {
    throw new AppError("Invalid settlement id.", 400);
  }

  return models.sequelize.transaction(async (t) => {
    const settlement = await models.CustomerSettlement.findByPk(sid, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!settlement) throw new AppError("Settlement not found.", 404);
    if (settlement.is_voided) throw new AppError("This settlement is already voided.", 409);

    const customer = await models.Customer.findByPk(settlement.customer_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!customer) throw new AppError("Customer not found.", 404);

    let balance = round2(customer.deposit_balance);
    const leftoverCredit =
      settlement.leftover_mode === "credit" ? round2(settlement.leftover_amount) : 0;
    if (leftoverCredit > 0) {
      if (balance + BALANCE_TOLERANCE < leftoverCredit) {
        throw new AppError(
          `Cannot void settlement #${sid}: Rs.${formatLkr(leftoverCredit)} wallet credit from this settlement has already been spent.`,
          409,
        );
      }
      balance = round2(Math.max(0, balance - leftoverCredit));
    }

    const walletUsed = round2(settlement.wallet_used_amount);
    if (walletUsed > 0) {
      balance = round2(balance + walletUsed);
    }

    if (balance !== round2(customer.deposit_balance)) {
      await customer.update({ deposit_balance: balance }, { transaction: t });
    }

    const [voidedCount] = await models.Payment.update(
      { is_voided: true, voided_at: now },
      { where: { settlement_id: sid, is_voided: false }, transaction: t },
    );

    await settlement.update(
      {
        is_voided: true,
        voided_at: now,
        voided_by: userId,
      },
      { transaction: t },
    );

    await touchCustomerBrief(models, settlement.customer_id, { transaction: t, now });

    const snap = parseJsonField(settlement.snapshot_json, {});
    const firstInvId = snap?.bills?.find((b) => b.changed)?.invoice_id || null;

    if (Number(settlement.payment_total || 0) > 0 || walletUsed > 0) {
      await maybeRecordActivity(
        models,
        {
          type: "payment_voided",
          invoice_id: firstInvId,
          customer_id: settlement.customer_id,
          actor_user_id: userId,
          amount: round2(Number(settlement.payment_total || 0) + walletUsed),
          occurred_at: now,
          data: {
            settlement_id: sid,
            voided_payments_count: voidedCount,
            reason_note: reason || null,
          },
        },
        { transaction: t },
      );
    }

    return {
      settlement_id: sid,
      is_voided: true,
      voided_at: now,
      voided_by: userId,
      voided_payments_count: voidedCount,
      deposit_balance: balance,
    };
  });
};

/**
 * 7. GET /api/settlements/:id
 * Returns the saved before/after for the receipt and WhatsApp (same layout as preview).
 */
export const getSettlementById = async (models, settlementId) => {
  const sid = Number(settlementId);
  if (!Number.isInteger(sid) || sid <= 0) {
    throw new AppError("Invalid settlement id.", 400);
  }

  const settlement = await models.CustomerSettlement.findByPk(sid, {
    include: [
      ...(models.Customer ? [{ model: models.Customer, required: false }] : []),
      ...(models.User
        ? [
            {
              model: models.User,
              as: "SettledBy",
              attributes: ["user_id", "username", "first_name", "last_name"],
              required: false,
            },
          ]
        : []),
    ],
  });
  if (!settlement) throw new AppError("Settlement not found.", 404);

  const snapshot = parseJsonField(settlement.snapshot_json, {});
  const staff = settlement.SettledBy
    ? `${settlement.SettledBy.first_name || ""} ${settlement.SettledBy.last_name || ""}`.trim() ||
      settlement.SettledBy.username
    : null;

  return {
    settlement_id: settlement.settlement_id,
    customer_id: settlement.customer_id,
    settled_at: settlement.settled_at,
    entered_at: settlement.entered_at,
    user_id: settlement.user_id,
    staff_name: staff,
    return_date: settlement.return_date,
    payment_total: round2(settlement.payment_total),
    leftover_mode: settlement.leftover_mode,
    leftover_amount: round2(settlement.leftover_amount),
    wallet_used_amount: round2(settlement.wallet_used_amount),
    split_rule: settlement.split_rule,
    note: settlement.note,
    is_voided: Boolean(settlement.is_voided),
    voided_at: settlement.voided_at,
    voided_by: settlement.voided_by,
    ...snapshot,
  };
};
