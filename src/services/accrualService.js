// Charges so far for machines that are still out.
//
// A line dispatched with no return date was priced for 1 day; a tracked line was priced up to its
// due date. While the machine stays out, the extra days (open-ended) or late days (tracked) keep
// adding up, but they are only billed into `line_total_amount` / `total_amount` at the handover.
// This keeps those running charges on the line (`accrued_charge`) and the invoice
// (`accrued_charges`) so the invoice total, the balance and every report agree with the ledger.
//
// The handover (processReturn) uses exactly the same rules, so the amount on screen is the amount
// that gets billed.
import { Op } from "sequelize";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import {
  dayInShopTz,
  elapsedRentalDays,
  isOpenEndedLine,
  lateDays,
  lineOutMoment,
  wholeDaysBetween,
} from "../utils/rentalDays.js";

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isTracked = (v) => !(v === false || v === 0 || v === "0");

/** Pure: the running charge on one line at `now`. Returned or fully-back lines carry nothing. */
export const lineAccrual = (line, issuedAt, now = new Date()) => {
  const qty = Number(line.borrow_quantity) || 0;
  const back = (Number(line.good_returned_qty) || 0) + (Number(line.defective_returned_qty) || 0);
  const pending = Math.max(0, qty - back);
  if (line.line_status !== "Active" || pending <= 0) return { accrued_charge: 0, accrued_days: 0, days_out: null };

  const rate = Number(line.locked_extra_daily_rate) || 0;
  if (isOpenEndedLine(line)) {
    // Elapsed time rounded up: past 24 hours is the next day.
    const daysOut = elapsedRentalDays(lineOutMoment(line, issuedAt), now);
    const extra = Math.max(0, daysOut - Math.max(1, Number(line.locked_minimum_days) || 1));
    return { accrued_charge: money(extra * rate * pending), accrued_days: extra, days_out: daysOut };
  }
  const today = dayInShopTz(now);
  const daysOut = Math.max(1, wholeDaysBetween(line.borrow_date, today));
  const late = isTracked(line.track_overdue) ? lateDays(line.expected_return_date, today) : 0;
  return { accrued_charge: money(late * rate * pending), accrued_days: late, days_out: daysOut };
};

/**
 * Recompute and save the running charges. With `invoiceIds`, those invoices (any status); without,
 * every Active invoice plus any that still carry a stale charge.
 */
export const refreshAccruals = async (models, { invoiceIds, now = new Date(), transaction } = {}) => {
  const where = invoiceIds
    ? { invoice_id: invoiceIds }
    : { [Op.or]: [{ status: "Active" }, { accrued_charges: { [Op.gt]: 0 } }] };
  const invoices = await models.Invoice.findAll({
    where,
    attributes: ["invoice_id", "issued_date", "status", "accrued_charges"],
    include: [{ model: models.InvoiceLine, required: false }],
    transaction,
  });

  let changed = 0;
  for (const invoice of invoices) {
    let total = 0;
    for (const line of invoice.InvoiceLines || []) {
      const a = lineAccrual(line, invoice.issued_date, now);
      total += a.accrued_charge;
      if (money(line.accrued_charge) !== a.accrued_charge || Number(line.accrued_days || 0) !== a.accrued_days || (line.days_out ?? null) !== a.days_out) {
        await line.update(a, { transaction });
      }
    }
    total = money(total);
    if (money(invoice.accrued_charges) !== total) {
      await invoice.update({ accrued_charges: total, accrued_at: now }, { transaction });
      changed++;
    }
  }
  return { invoices: invoices.length, changed };
};

// Lists and reports refresh at most once a minute per shop; a single invoice is refreshed every time.
const FRESH_MS = 60 * 1000;
const lastRun = new Map();
const running = new Map();

export const ensureFreshAccruals = async (models, { now = new Date() } = {}) => {
  const key = models.sequelize?.config?.database || "default";
  if (running.has(key)) return running.get(key);
  if (now.getTime() - (lastRun.get(key) || 0) < FRESH_MS) return null;
  const job = refreshAccruals(models, { now })
    .then((r) => {
      lastRun.set(key, Date.now());
      return r;
    })
    .finally(() => running.delete(key));
  running.set(key, job);
  return job;
};

/** For tests. */
export const resetAccrualThrottle = () => {
  lastRun.clear();
  running.clear();
};

/** Express middleware (after `protect`): make sure running charges are current before reading totals. */
export const freshAccruals = async (req, res, next) => {
  try {
    if (req.user?.tenantDbName) {
      await ensureFreshAccruals(initTenantModels(getCachedTenantConnection(req.user.tenantDbName)));
    }
  } catch (err) {
    // Never block a page over this; the totals are at most a minute old.
    console.error("accruals: refresh failed", err?.message);
  }
  next();
};
