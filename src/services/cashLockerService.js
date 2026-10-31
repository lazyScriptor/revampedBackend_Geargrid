// Cash locker: the shop's single cash drawer.
//
// The drawer holds a fixed float plus every CASH advance on invoices that are not completed yet
// ("keep"); everything above that goes home each evening. Staff only enter counts:
//   • START    — once, to begin (old advances already at home can be marked so)
//   • OPENING  — each morning
//   • CLOSING  — each evening (optional), with what was sent home
// What the drawer should hold at any moment = the latest count's `left_in_drawer` + every cash
// movement recorded after it (cash payments and advances in, cash refunds and locker expenses out).
import { Op } from "sequelize";
import AppError from "../utils/AppError.js";
import { parseTenantDay } from "../utils/dateRange.js";
import { pickWhatsAppNumber } from "../utils/whatsappPhone.js";
import { createNotification } from "./notificationService.js";
import { createExpense } from "./expenseService.js";

const DEFAULT_TZ = "Asia/Colombo";
export const DEFAULT_FLOAT = 1500;
export const PAYMENT_METHODS = ["Cash", "Card", "Transfer", "Cheque"];
const CENT = 0.005;

export const isCash = (method) => String(method || "").trim().toLowerCase() === "cash";
export const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

const parseJson = (v) => {
  if (!v) return {};
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
};

const fmt = (n) => `Rs. ${money(n).toLocaleString("en-LK", { maximumFractionDigits: 2 })}`;

export const dayInTz = (date, tz = DEFAULT_TZ) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

const timeInTz = (date, tz = DEFAULT_TZ) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(date);

const customerName = (c) => {
  if (!c) return "";
  if (c.customer_type === "Business" && c.company_name) return c.company_name;
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company_name || "";
};

const userName = (u) => (u ? [u.first_name, u.last_name].filter(Boolean).join(" ") : "");

// ─── pure calculations ───────────────────────────────────────────────────────

/**
 * Cash each open invoice's advance is holding in the drawer: the cash advance minus any cash
 * already refunded on that invoice. Advances paid by card / transfer / wallet were never in the drawer.
 */
export const heldAdvances = (invoices) =>
  invoices
    .map((inv) => {
      const payments = (inv.Payments || []).filter((p) => !p.is_voided);
      let advances = payments.filter((p) => p.is_advance);
      // Invoices written before advances were marked: the advance is the first payment.
      if (!advances.length && Number(inv.advance_paid) > 0) {
        const first = [...payments].sort((a, b) => a.payment_id - b.payment_id).find((p) => Number(p.payment_amount) > 0);
        advances = first ? [first] : [];
      }
      const advance = advances.filter((p) => isCash(p.method)).reduce((s, p) => s + Number(p.payment_amount), 0);
      const refunded = payments
        .filter((p) => Number(p.payment_amount) < 0 && isCash(p.method))
        .reduce((s, p) => s - Number(p.payment_amount), 0);
      const lines = inv.InvoiceLines || [];
      return {
        invoice_id: inv.invoice_id,
        customer_name: customerName(inv.Customer),
        issued_date: inv.issued_date,
        status: inv.status,
        advance: money(advance),
        refunded: money(refunded),
        held: money(Math.max(0, advance - refunded)),
        // Every machine is back but the invoice was never completed, so its advance is still held.
        all_back: lines.length > 0 && lines.every((l) => l.line_status !== "Active"),
      };
    })
    .filter((h) => h.held > CENT);

/** Every payment and locker expense after the last count, oldest first. Only cash changes the drawer. */
export const buildMovements = (payments, expenses, usersById = {}) =>
  [
    ...payments.map((p) => {
      const amount = money(p.payment_amount);
      return {
        id: `p${p.payment_id}`,
        type: p.is_advance ? "advance" : amount < 0 ? "refund" : "payment",
        at: p.payment_date,
        amount,
        method: p.method,
        in_drawer: isCash(p.method),
        payment_id: p.payment_id,
        invoice_id: p.invoice_id,
        customer_name: customerName(p.Invoice?.Customer),
        by: userName(usersById[p.received_by_user_id]),
      };
    }),
    ...expenses.map((e) => ({
      id: `e${e.expense_id}`,
      type: "expense",
      at: e.createdAt,
      amount: -money(e.amount),
      method: "Cash",
      in_drawer: true,
      expense_id: e.expense_id,
      category: e.category,
      description: e.description || "",
      by: userName(usersById[e.recorded_by_user_id]),
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

export const drawerChange = (movements) => money(movements.reduce((s, m) => s + (m.in_drawer ? m.amount : 0), 0));

/** Evening split: what stays (float + held advances) and what goes home. Negative = top the drawer up. */
export const closingSplit = ({ counted, keep }) => ({ keep: money(keep), send_home: money(counted - keep) });

// ─── loading ─────────────────────────────────────────────────────────────────

const shopTz = async (models) => (await models.TenantConfig.findOne())?.timezone || DEFAULT_TZ;

export const getFloat = async (models) => {
  const config = await models.TenantConfig.findOne();
  const value = parseJson(config?.custom_settings).cash_locker?.float;
  return value === undefined || value === null || !Number.isFinite(Number(value)) ? DEFAULT_FLOAT : money(value);
};

export const setFloat = async (models, amount) => {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000) throw new AppError("Enter the float as an amount of 0 or more.", 400);
  let config = await models.TenantConfig.findOne();
  if (!config) config = await models.TenantConfig.create({ business_display_name: "My Rental Co" });
  const custom = parseJson(config.custom_settings);
  await config.update({ custom_settings: { ...custom, cash_locker: { ...parseJson(custom.cash_locker), float: money(value) } } });
  return { float: money(value) };
};

const loadHeld = async (models) => {
  const invoices = await models.Invoice.findAll({
    where: { status: { [Op.ne]: "Completed" }, advance_at_home: false, advance_paid: { [Op.gt]: 0 } },
    attributes: ["invoice_id", "status", "issued_date", "advance_paid"],
    include: [
      { model: models.Payment, attributes: ["payment_id", "payment_amount", "method", "is_advance", "is_voided"], required: false },
      { model: models.Customer, attributes: ["first_name", "last_name", "company_name", "customer_type"], required: false },
      { model: models.InvoiceLine, attributes: ["line_id", "line_status"], required: false },
    ],
    order: [["invoice_id", "ASC"]],
  });
  return heldAdvances(invoices.map((i) => i.toJSON()));
};

const loadMovements = async (models, since) => {
  const payments = await models.Payment.findAll({
    where: { is_voided: false, payment_date: { [Op.gt]: since } },
    include: [
      {
        model: models.Invoice,
        attributes: ["invoice_id"],
        required: true, // the Invoice default scope drops deleted invoices
        include: [{ model: models.Customer, attributes: ["first_name", "last_name", "company_name", "customer_type"], required: false }],
      },
    ],
  });
  const expenses = await models.Expense.findAll({
    where: { paid_from_locker: true, createdAt: { [Op.gt]: since } },
    attributes: ["expense_id", "amount", "category", "description", "createdAt", "recorded_by_user_id"],
  });
  const userIds = [...new Set([...payments.map((p) => p.received_by_user_id), ...expenses.map((e) => e.recorded_by_user_id)].filter(Boolean))];
  const users = userIds.length
    ? await models.User.findAll({ where: { user_id: userIds }, attributes: ["user_id", "first_name", "last_name"] })
    : [];
  const usersById = Object.fromEntries(users.map((u) => [u.user_id, u]));
  return buildMovements(
    payments.map((p) => p.toJSON()),
    expenses.map((e) => e.toJSON()),
    usersById,
  );
};

const lastCount = (models) =>
  models.CashLockerCount.findOne({
    order: [["counted_at", "DESC"], ["count_id", "DESC"]],
    include: [{ model: models.User, as: "CountedBy", attributes: ["user_id", "first_name", "last_name"], required: false }],
  });

/** Active users whose role can manage the locker (the owners), with a WhatsApp number when one is on file. */
const findOwners = async (models) => {
  const users = await models.User.findAll({
    where: { is_active: true },
    attributes: ["user_id", "first_name", "last_name", "phone_number"],
    include: [
      {
        model: models.Role,
        attributes: ["role_id"],
        through: { attributes: [] },
        required: true,
        include: [{ model: models.Permission, attributes: ["permission_code"], through: { attributes: [] }, where: { permission_code: "locker:manage" }, required: true }],
      },
    ],
  });
  return users.map((u) => {
    const phone = pickWhatsAppNumber(u.phone_number);
    return { user_id: u.user_id, name: userName(u), whatsapp: phone.valid ? phone.digits : null };
  });
};

const notifyOwners = async (models, actorUserId, notification) => {
  try {
    const owners = await findOwners(models);
    for (const o of owners) {
      if (o.user_id === actorUserId) continue;
      await createNotification(models, { userId: o.user_id, category: "cash_locker", link: "/locker", ...notification });
    }
  } catch (err) {
    // A failed notification must never lose the count.
    console.error("cash locker: owner notification failed", err?.message);
  }
};

// ─── status ──────────────────────────────────────────────────────────────────

export const getStatus = async (models, { now = new Date() } = {}) => {
  const tz = await shopTz(models);
  const today = dayInTz(now, tz);
  const [float, last, held] = await Promise.all([getFloat(models), lastCount(models), loadHeld(models)]);
  const todays = await models.CashLockerCount.findAll({
    where: { business_date: today },
    order: [["counted_at", "ASC"]],
    include: [{ model: models.User, as: "CountedBy", attributes: ["user_id", "first_name", "last_name"], required: false }],
  });

  const since = last ? last.counted_at : parseTenantDay(today, tz).start;
  const movements = await loadMovements(models, since);
  const change = drawerChange(movements);
  const expected = last ? money(Number(last.left_in_drawer) + change) : null;
  const heldTotal = money(held.reduce((s, h) => s + h.held, 0));
  const keep = money(float + heldTotal);
  const owners = await findOwners(models).catch(() => []);

  return {
    business_date: today,
    timezone: tz,
    float,
    started: !!last,
    opening: todays.find((c) => c.kind === "OPENING" || c.kind === "START") || null,
    todays_counts: todays,
    needs_opening: !!last && todays.length === 0,
    last_count: last,
    since,
    movements,
    drawer_change: change,
    expected_now: expected,
    held,
    held_total: heldTotal,
    keep,
    send_home: expected === null ? null : money(expected - keep),
    owner_whatsapp: owners.find((o) => o.whatsapp)?.whatsapp || null,
  };
};

// ─── counts ──────────────────────────────────────────────────────────────────

const parseAmount = (v, label) => {
  const n = Number(v);
  if (v === "" || v === null || v === undefined || !Number.isFinite(n) || n < 0 || n > 100_000_000) {
    throw new AppError(`Enter ${label} as an amount of 0 or more.`, 400);
  }
  return money(n);
};

const differenceText = (diff) => (Math.abs(diff) < CENT ? "matches" : `${fmt(Math.abs(diff))} ${diff < 0 ? "short" : "over"}`);

export const recordOpening = async (models, { amount, reason, userId, userLabel, now = new Date() }) => {
  const counted = parseAmount(amount, "the amount in the locker");
  const status = await getStatus(models, { now });
  if (!status.started) throw new AppError("The cash locker has not been started yet. Ask the owner to start it.", 409);
  if (status.todays_counts.some((c) => c.kind === "OPENING" || c.kind === "START")) {
    throw new AppError("Today's opening amount is already entered.", 409);
  }
  const expected = status.expected_now;
  const difference = money(counted - expected);
  const row = await models.CashLockerCount.create({
    kind: "OPENING",
    business_date: status.business_date,
    counted_at: now,
    counted_amount: counted,
    expected_amount: expected,
    difference,
    sent_home: 0,
    left_in_drawer: counted,
    reason: reason ? String(reason).trim().slice(0, 1000) || null : null,
    counted_by_user_id: userId,
  });

  const mismatch = Math.abs(difference) >= CENT;
  await notifyOwners(models, userId, {
    type: mismatch ? "warning" : "info",
    title: `Locker opened: ${fmt(counted)}`,
    message:
      `${userLabel || "Staff"} counted at ${timeInTz(now, status.timezone)}. ` +
      (mismatch ? `Expected ${fmt(expected)}: ${differenceText(difference)}.` : "Matches last night.") +
      (row.reason ? ` Note: ${row.reason}` : ""),
    payload: { count_id: row.count_id, kind: "OPENING", counted, expected, difference },
  });

  return { count: row, owner_whatsapp: status.owner_whatsapp };
};

export const recordClosing = async (models, { counted: countedRaw, sent_home, reason, userId, userLabel, now = new Date() }) => {
  const counted = parseAmount(countedRaw, "the amount you counted");
  const status = await getStatus(models, { now });
  if (!status.started) throw new AppError("The cash locker has not been started yet. Ask the owner to start it.", 409);

  const expected = status.expected_now;
  const difference = money(counted - expected);
  const note = reason ? String(reason).trim().slice(0, 1000) : "";
  if (Math.abs(difference) >= CENT && !note) {
    throw new AppError(`The count is ${differenceText(difference)}. Write a short reason before saving.`, 400);
  }
  const sent =
    sent_home === undefined || sent_home === null || sent_home === ""
      ? money(Math.max(0, counted - status.keep))
      : parseAmount(sent_home, "the amount sent home");
  if (sent > counted + CENT) throw new AppError("You cannot send home more than you counted.", 400);

  const row = await models.CashLockerCount.create({
    kind: "CLOSING",
    business_date: status.business_date,
    counted_at: now,
    counted_amount: counted,
    expected_amount: expected,
    difference,
    keep_amount: status.keep,
    sent_home: sent,
    left_in_drawer: money(counted - sent),
    reason: note || null,
    counted_by_user_id: userId,
  });

  const mismatch = Math.abs(difference) >= CENT;
  await notifyOwners(models, userId, {
    type: mismatch ? "warning" : "success",
    title: `Day closed: ${fmt(sent)} sent home`,
    message:
      `${userLabel || "Staff"} counted ${fmt(counted)} at ${timeInTz(now, status.timezone)}, kept ${fmt(counted - sent)}. ` +
      (mismatch ? `Expected ${fmt(expected)}: ${differenceText(difference)}. Reason: ${note}` : "Count matches."),
    payload: { count_id: row.count_id, kind: "CLOSING", counted, expected, difference, sent_home: sent },
  });

  return { count: row };
};

/** Lists what the drawer should hold before the one-time start. */
export const getStartPreview = async (models) => {
  const [float, held, last] = await Promise.all([getFloat(models), loadHeld(models), lastCount(models)]);
  return { started: !!last, float, held, keep: money(float + held.reduce((s, h) => s + h.held, 0)) };
};

export const startLocker = async (models, { counted: countedRaw, at_home_invoice_ids = [], sent_home, reason, userId, now = new Date() }) => {
  const counted = parseAmount(countedRaw, "the amount you counted");
  if (await lastCount(models)) throw new AppError("The cash locker is already running.", 409);

  const ids = (Array.isArray(at_home_invoice_ids) ? at_home_invoice_ids : []).map(Number).filter(Number.isInteger);
  return models.sequelize.transaction(async (t) => {
    if (ids.length) {
      await models.Invoice.update({ advance_at_home: true }, { where: { invoice_id: ids }, transaction: t });
    }
    const status = await getStatus(models, { now });
    const keep = status.keep;
    // Cash above "keep" is income that has not gone home yet; only a shortfall is a difference.
    const difference = money(Math.min(0, counted - keep));
    const note = reason ? String(reason).trim().slice(0, 1000) : "";
    if (difference < -CENT && !note) {
      throw new AppError(`The drawer is ${fmt(-difference)} short of what it should hold. Write a short note before starting.`, 400);
    }
    const sent =
      sent_home === undefined || sent_home === null || sent_home === ""
        ? money(Math.max(0, counted - keep))
        : parseAmount(sent_home, "the amount sent home");
    if (sent > counted + CENT) throw new AppError("You cannot send home more than you counted.", 400);

    const row = await models.CashLockerCount.create(
      {
        kind: "START",
        business_date: status.business_date,
        counted_at: now,
        counted_amount: counted,
        expected_amount: keep,
        difference,
        keep_amount: keep,
        sent_home: sent,
        left_in_drawer: money(counted - sent),
        reason: note || null,
        counted_by_user_id: userId,
      },
      { transaction: t },
    );
    return { count: row };
  });
};

export const reviewCount = async (models, { countId, note, userId }) => {
  const row = await models.CashLockerCount.findByPk(countId);
  if (!row) throw new AppError("Count not found.", 404);
  await row.update({ reviewed_by_user_id: userId, reviewed_at: new Date(), review_note: note ? String(note).trim().slice(0, 1000) || null : null });
  return row;
};

export const listHistory = async (models, { limit = 60, offset = 0 } = {}) => {
  const { count, rows } = await models.CashLockerCount.findAndCountAll({
    order: [["counted_at", "DESC"], ["count_id", "DESC"]],
    limit: Math.min(200, Math.max(1, Number(limit) || 60)),
    offset: Math.max(0, Number(offset) || 0),
    include: [
      { model: models.User, as: "CountedBy", attributes: ["user_id", "first_name", "last_name"], required: false },
      { model: models.User, as: "ReviewedBy", attributes: ["user_id", "first_name", "last_name"], required: false },
    ],
  });
  return { total: count, rows };
};

export const setAdvanceAtHome = async (models, { invoiceId, atHome }) => {
  const invoice = await models.Invoice.findByPk(invoiceId);
  if (!invoice) throw new AppError("Invoice not found.", 404);
  await invoice.update({ advance_at_home: !!atHome });
  return { invoice_id: invoice.invoice_id, advance_at_home: invoice.advance_at_home };
};

export const recordLockerExpense = (models, payload, userId) =>
  createExpense(models, { category: "Operational", ...payload, date: payload?.date || new Date(), paid_from_locker: true }, userId);

/**
 * Fix the method of a payment taken since the last count (the usual cause of a drawer mismatch:
 * a card or transfer saved as Cash, or the other way round). Older payments are already counted.
 */
export const changePaymentMethod = async (models, { paymentId, method, userId }) => {
  if (!PAYMENT_METHODS.includes(method)) throw new AppError(`Choose one of: ${PAYMENT_METHODS.join(", ")}.`, 400);
  const payment = await models.Payment.findByPk(paymentId);
  if (!payment || payment.is_voided) throw new AppError("Payment not found.", 404);
  const last = await lastCount(models);
  if (last && new Date(payment.payment_date).getTime() <= new Date(last.counted_at).getTime()) {
    throw new AppError("This payment was already counted in an earlier drawer count and can no longer be changed here.", 409);
  }
  const previous = payment.method;
  if (previous === method) return payment;
  await payment.update({ method });
  await models.InvoiceTrace.create({
    invoice_id: payment.invoice_id,
    actor_user_id: userId,
    event_category: "FINANCE",
    event_action: "PAYMENT_METHOD_CHANGED",
    comments: `Payment of Rs.${Math.abs(Number(payment.payment_amount))} changed from ${previous} to ${method} (cash locker check).`,
  });
  return payment;
};
