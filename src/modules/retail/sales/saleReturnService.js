import { Op } from "sequelize";
import AppError from "../../../utils/AppError.js";
import { lineNetCents, returnableBaseQty, returnableQty, returnValueCents } from "../../../utils/saleReturnMath.js";
import { notifyEvent } from "../../../services/pushEventService.js";
import { fromCents, toCents } from "../money.js";
import { getRetailSettings } from "../retailSettingsService.js";
import { consumeApprovalToken, recordCounterException } from "../approvalService.js";
import { returnSale } from "../stock/stockService.js";
import { escapeLike } from "../catalog/naming.js";

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TOLERANCE_CENTS = 0; // all money here is whole cents

const formatLkr = (cents) => {
  const n = cents / 100;
  return Number.isInteger(n)
    ? n.toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const hasPermission = (effectivePermissions, code) => {
  if (effectivePermissions === null || effectivePermissions === undefined) return true; // route already checked
  if (effectivePermissions instanceof Set) return effectivePermissions.has(code) || effectivePermissions.has("*");
  if (Array.isArray(effectivePermissions)) return effectivePermissions.includes(code) || effectivePermissions.includes("*");
  return true;
};

const pickApprovalToken = (tokens, type) => {
  if (!tokens) return null;
  if (typeof tokens === "string") return tokens;
  if (Array.isArray(tokens)) {
    const m = tokens.find((t) => t && t.type === type);
    return m?.token ?? null;
  }
  const entry = tokens[type];
  if (!entry) return null;
  return typeof entry === "string" ? entry : entry.token ?? null;
};

const customerLabel = (c) => {
  if (!c) return "Customer";
  if (c.customer_type === "Business" && c.company_name) return c.company_name;
  return `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Customer";
};

const refusal = (message, status, code, data) => {
  const err = new AppError(message, status);
  err.code = code;
  err.data = { code, ...(data || {}) };
  return err;
};

/**
 * Return sold items from their bill (plan §5.4, with the R5 decision for completed bills).
 * ONE transaction: stock, the lines, the bill totals, the refund, the status and the trace.
 *
 *   lines: [{ sale_line_id, qty, unit_id?, condition: 'good'|'damaged', serial_no? }]
 *     qty is in the line's own unit unless unit_id names another unit of the item
 *     (unit_id: null means single base pieces).
 *   settlement: { mode: 'refund'|'credit', amount?, method? }
 */
export const returnSaleLines = async (
  models,
  invoiceId,
  {
    lines,
    settlement = {},
    reason = null,
    approval_tokens = null,
    userId = null,
    effectivePermissions = null,
    transaction = null,
    now = new Date(),
  } = {},
) => {
  if (!hasPermission(effectivePermissions, "retail:return")) {
    throw new AppError("You do not have permission to return sold items.", 403);
  }
  if (transaction) {
    return publicResult(await runReturn(models, invoiceId, { lines, settlement, reason, approval_tokens, userId, transaction, now }));
  }
  const result = await models.sequelize.transaction((t) =>
    runReturn(models, invoiceId, { lines, settlement, reason, approval_tokens, userId, transaction: t, now }),
  );
  announceReturn(models, result, userId);
  return publicResult(result);
};

const publicResult = ({ _valueCents, _customer, ...rest }) => rest;

const runReturn = async (models, invoiceId, { lines, settlement, reason, approval_tokens, userId, transaction, now }) => {
  const opts = { transaction };
  const lockOpts = transaction?.LOCK ? { transaction, lock: transaction.LOCK.UPDATE } : opts;
  const id = Number(invoiceId);

  if (!Array.isArray(lines) || lines.length === 0) {
    throw new AppError("lines must be a non-empty array.", 400);
  }
  const seen = new Set();
  for (const raw of lines) {
    const sid = Number(raw?.sale_line_id);
    if (!Number.isInteger(sid) || sid <= 0) throw new AppError("Each line needs a sale_line_id.", 400);
    if (seen.has(sid)) throw new AppError(`Sale line ${sid} appears twice; combine the quantities.`, 400);
    seen.add(sid);
    const q = Number(raw?.qty);
    if (!Number.isFinite(q) || q <= 0) throw new AppError("Each line needs a qty greater than 0.", 400);
    const cond = raw?.condition ?? "good";
    if (cond !== "good" && cond !== "damaged") throw new AppError("condition must be 'good' or 'damaged'.", 400);
  }
  const mode = settlement?.mode;
  if (mode !== undefined && mode !== null && mode !== "refund" && mode !== "credit") {
    throw new AppError("settlement.mode must be 'refund' or 'credit'.", 400);
  }

  const invoice = await models.Invoice.findByPk(id, lockOpts);
  if (!invoice || invoice.is_deleted) throw new AppError("Bill not found.", 404);
  if (invoice.bill_kind !== "sale" && invoice.bill_kind !== "mixed") {
    throw new AppError("This bill has no sold items to return.", 409);
  }

  const saleLines = await models.InvoiceSaleLine.findAll({
    where: { invoice_id: id },
    ...(transaction?.LOCK ? { lock: transaction.LOCK.UPDATE } : {}),
    ...opts,
  });
  const lineById = new Map(saleLines.map((l) => [Number(l.sale_line_id), l]));

  const productIds = [...new Set(saleLines.filter((l) => l.product_id).map((l) => Number(l.product_id)))];
  const products = productIds.length
    ? await models.RetailProduct.findAll({ where: { product_id: { [Op.in]: productIds } }, ...opts })
    : [];
  const productsById = new Map(products.map((p) => [Number(p.product_id), p]));
  const requestedUnitIds = [...new Set(lines.map((r) => r?.unit_id).filter((u) => u != null).map(Number))];
  const unitRows = requestedUnitIds.length
    ? await models.RetailProductUnit.findAll({ where: { unit_id: { [Op.in]: requestedUnitIds } }, ...opts })
    : [];

  // ── per-line checks and the value to hand back ────────────────────────────
  const prepared = [];
  let valueCents = 0;
  for (const raw of lines) {
    const line = lineById.get(Number(raw.sale_line_id));
    if (!line) throw new AppError(`Sale line ${raw.sale_line_id} is not on this bill.`, 404);
    if (line.status === "voided") throw new AppError(`Sale line ${line.sale_line_id} was voided.`, 409);

    let factor;
    let unitLabel = line.unit_label || line.unit_name || "pcs";
    if (!("unit_id" in raw)) {
      factor = Number(line.unit_factor) > 0 ? Number(line.unit_factor) : 1;
    } else if (raw.unit_id === null) {
      factor = 1;
      unitLabel = "base";
    } else if (line.unit_id && Number(raw.unit_id) === Number(line.unit_id)) {
      factor = Number(line.unit_factor) > 0 ? Number(line.unit_factor) : 1;
    } else {
      const unit = unitRows.find(
        (u) => Number(u.unit_id) === Number(raw.unit_id) && Number(u.product_id) === Number(line.product_id),
      );
      if (!unit) throw new AppError(`Unit ${raw.unit_id} does not belong to this item.`, 400);
      factor = Number(unit.factor);
      unitLabel = unit.unit_name || unitLabel;
    }
    const baseQty = round3(Number(raw.qty) * factor);
    if (baseQty <= 0) throw new AppError("The quantity is too small to return.", 400);

    const product = line.product_id ? productsById.get(Number(line.product_id)) : null;
    if (product && !product.allow_decimal && Math.abs(baseQty - Math.round(baseQty)) > 1e-6) {
      throw new AppError(`${product.name} cannot be returned in part of a piece.`, 400);
    }

    const canReturn = returnableBaseQty(line);
    if (baseQty > canReturn + 1e-9) {
      throw refusal(
        canReturn > 0
          ? `Only ${returnableQty(line)} ${line.unit_label || "pcs"} of ${line.description} can still be returned.`
          : `${line.description} has already been fully returned.`,
        409,
        "return_exceeds_sold",
        {
          sale_line_id: Number(line.sale_line_id),
          returnable_base_qty: canReturn,
          returnable_qty: returnableQty(line),
          unit_label: line.unit_label || "pcs",
        },
      );
    }

    // One serial-numbered unit per line, and it must be the one sold on that line.
    let serialNo = null;
    if (product?.tracking === "serial") {
      const soldSerial = line.serial_no ? String(line.serial_no).trim() : null;
      const given = raw.serial_no != null && String(raw.serial_no).trim() ? String(raw.serial_no).trim() : null;
      if (given && soldSerial && given !== soldSerial) {
        throw refusal(`Serial ${given} was not sold on this line (it sold ${soldSerial}).`, 409, "wrong_serial", {
          sale_line_id: Number(line.sale_line_id),
          sold_serial_no: soldSerial,
        });
      }
      serialNo = given || soldSerial;
      if (!serialNo) throw new AppError(`Serial number is required to return ${product.name}.`, 400);
    }

    const value = returnValueCents(line, baseQty);
    valueCents += value;
    prepared.push({
      line,
      product,
      qty: Number(raw.qty),
      baseQty,
      unitLabel,
      condition: raw.condition ?? "good",
      serialNo,
      value,
    });
  }

  // ── return window: a late return needs a reason or a manager ──────────────
  const settings = await getRetailSettings(models);
  const limit = Number(settings.returnDaysLimit || 0);
  const issued = invoice.issued_date ? new Date(invoice.issued_date) : null;
  const ageDays = issued && !Number.isNaN(issued.getTime()) ? Math.floor((now.getTime() - issued.getTime()) / DAY_MS) : 0;
  const reasonText = reason ? String(reason).trim().slice(0, 300) : "";
  if (limit > 0 && ageDays > limit) {
    const policy = settings.exceptions?.return_no_bill || "approve";
    if (policy !== "off") {
      const exceptionBase = {
        type: "return_no_bill",
        invoice_id: id,
        amount_impact: fromCents(valueCents),
        summary: `Return of Rs ${formatLkr(valueCents)} on bill #${id}, ${ageDays} days old (limit ${limit})`,
        context: { invoice_id: id, value: fromCents(valueCents), bill_age_days: ageDays, days_limit: limit, reason: reasonText || null },
        note: reasonText || null,
      };
      if (!reasonText && policy === "approve") {
        const token = pickApprovalToken(approval_tokens, "return_no_bill");
        if (!token) {
          throw refusal(
            `This bill is ${ageDays} days old (limit ${limit}). Give a reason or ask a manager to approve the return.`,
            403,
            "return_approval_required",
            { days_limit: limit, bill_age_days: ageDays, value: fromCents(valueCents) },
          );
        }
        const consumed = await consumeApprovalToken(models, token, {
          type: "return_no_bill",
          verify: (ctx) =>
            Number(ctx.invoice_id) === id && toCents(ctx.value ?? ctx.amount ?? ctx.return_value ?? 0) >= valueCents,
          userId,
          transaction,
          now,
        });
        await models.CounterException.create(
          {
            type: "return_no_bill",
            status: "approved",
            invoice_id: id,
            requested_by: userId,
            approved_by: consumed.approver_user_id,
            approved_at: now,
            new_value: exceptionBase.context,
            amount_impact: exceptionBase.amount_impact,
            summary: exceptionBase.summary,
            created_at: now,
          },
          opts,
        );
      } else {
        await recordCounterException(models, userId, exceptionBase, { now, transaction });
      }
    }
  }

  // ── settlement checks (before anything is written) ────────────────────────
  const customer = invoice.customer_id ? await models.Customer.findByPk(invoice.customer_id, opts) : null;
  const isWalkIn = Boolean(customer?.is_walk_in);
  const isCompleted = invoice.status === "Completed";

  const newTotalCents = Math.max(0, toCents(invoice.total_amount) - valueCents);
  const newSaleTotalCents = Math.max(0, toCents(invoice.sale_total) - valueCents);
  const newLiveCents = newTotalCents + toCents(invoice.accrued_charges);
  const netPaidCents = toCents(
    await models.Payment.sum("payment_amount", { where: { invoice_id: id, is_voided: false }, ...opts }),
  );

  let effectiveMode = mode;
  if (!effectiveMode) {
    if (isCompleted || isWalkIn) effectiveMode = "refund";
    else throw new AppError("settlement.mode is required: 'refund' or 'credit'.", 400);
  }
  if (effectiveMode === "credit") {
    if (isCompleted) {
      throw refusal(
        "This bill is closed: refund the return, or reopen the bill to keep it as credit.",
        409,
        "credit_not_allowed_closed",
      );
    }
    if (isWalkIn) {
      throw refusal("The walk-in customer cannot keep credit: refund the return.", 409, "credit_not_allowed_walk_in");
    }
  }

  let refundCents = 0;
  let refundMethod = "Cash";
  if (effectiveMode === "refund") {
    const maxRefundCents = Math.max(0, netPaidCents - newLiveCents);
    refundCents = settlement?.amount != null && settlement.amount !== "" ? toCents(settlement.amount) : valueCents;
    refundMethod = settlement?.method ? String(settlement.method).slice(0, 50) : "Cash";
    if (refundCents < 0 || (refundCents === 0 && valueCents > 0)) {
      throw new AppError("The refund amount must be greater than 0.", 400);
    }
    if (isCompleted && refundCents !== valueCents) {
      throw refusal(
        `This bill is closed: the refund must be exactly the returned value, Rs ${formatLkr(valueCents)}.`,
        409,
        "refund_must_equal_return",
        { returned_value: fromCents(valueCents) },
      );
    }
    if (refundCents > maxRefundCents + TOLERANCE_CENTS) {
      throw refusal(
        `Cannot refund Rs ${formatLkr(refundCents)}: at most Rs ${formatLkr(maxRefundCents)} can be refunded on this bill.`,
        409,
        "refund_exceeds_paid",
        { max_refund: fromCents(maxRefundCents) },
      );
    }
  }

  // ── stock ─────────────────────────────────────────────────────────────────
  await returnSale(models, {
    lines: prepared.map((p) => ({
      sale_line_id: p.line.sale_line_id,
      product_id: p.line.product_id,
      warehouse_id: p.line.warehouse_id,
      base_qty: p.baseQty,
      unit_cost: Number(p.line.unit_cost || 0),
      condition: p.condition,
      serial_no: p.serialNo,
    })),
    invoiceId: id,
    userId,
    occurredAt: now,
    now,
    transaction,
  });

  // ── the lines ─────────────────────────────────────────────────────────────
  for (const p of prepared) {
    const returned = round3(Number(p.line.returned_base_qty || 0) + p.baseQty);
    const full = returned >= round3(p.line.base_qty) - 1e-9;
    await p.line.update({ returned_base_qty: returned, status: full ? "returned" : "partly_returned" }, opts);
  }

  // ── the bill totals ───────────────────────────────────────────────────────
  await invoice.update(
    { total_amount: fromCents(newTotalCents), sale_total: fromCents(newSaleTotalCents) },
    opts,
  );

  // ── the money ─────────────────────────────────────────────────────────────
  let payment = null;
  if (refundCents > 0) {
    payment = await models.Payment.create(
      {
        invoice_id: id,
        payment_amount: -fromCents(refundCents),
        method: refundMethod,
        received_by_user_id: userId,
        is_advance: false,
      },
      opts,
    );
    if (refundMethod === "WalletDeposit" && customer) {
      const next = Math.round((Number(customer.deposit_balance || 0) + fromCents(refundCents)) * 100) / 100;
      await customer.update({ deposit_balance: next }, opts);
    }
  }
  const creditedCents = valueCents - refundCents;
  const balanceAfterCents = newLiveCents - (netPaidCents - refundCents);

  // ── status ────────────────────────────────────────────────────────────────
  let becameCompleted = false;
  if (!isCompleted && invoice.bill_kind === "sale" && invoice.status === "PendingPayment" && balanceAfterCents === 0) {
    await invoice.update({ status: "Completed" }, opts);
    becameCompleted = true;
  }

  // ── trace ─────────────────────────────────────────────────────────────────
  const statePayload = {
    lines: prepared.map((p) => ({
      sale_line_id: Number(p.line.sale_line_id),
      description: p.line.description,
      qty: p.qty,
      unit: p.unitLabel,
      base_qty: p.baseQty,
      condition: p.condition,
      ...(p.serialNo ? { serial_no: p.serialNo } : {}),
      value: fromCents(p.value),
    })),
    value: fromCents(valueCents),
    settlement: {
      mode: effectiveMode,
      refunded: fromCents(refundCents),
      credited: fromCents(creditedCents),
      method: refundCents > 0 ? refundMethod : null,
      payment_id: payment?.payment_id ?? null,
    },
    reason: reasonText || null,
    bill_status: becameCompleted ? "Completed" : invoice.status,
  };
  await models.InvoiceTrace.create(
    {
      invoice_id: id,
      actor_user_id: userId,
      event_category: "RETAIL",
      event_action: "SALE_RETURN",
      comments:
        `Return of Rs ${formatLkr(valueCents)}` +
        (refundCents > 0 ? `, refunded Rs ${formatLkr(refundCents)} (${refundMethod})` : "") +
        (creditedCents > 0 ? `, Rs ${formatLkr(creditedCents)} kept on the bill` : "") +
        (reasonText ? `. Reason: ${reasonText}` : ""),
      state_payload: statePayload,
    },
    opts,
  );
  if (becameCompleted) {
    await models.InvoiceTrace.create(
      {
        invoice_id: id,
        actor_user_id: userId,
        event_category: "SETTLEMENT",
        event_action: "INVOICE_COMPLETED",
        comments: "Invoice completed and closed: the balance reached 0 after a return.",
      },
      opts,
    );
  }
  if (invoice.customer_id && models.Customer?.update) {
    await models.Customer.update({ brief_changed_at: now }, { where: { customer_id: invoice.customer_id }, ...opts });
  }

  return {
    invoice_id: id,
    customer_id: invoice.customer_id,
    returned_value: fromCents(valueCents),
    status: becameCompleted ? "Completed" : invoice.status,
    balance: fromCents(balanceAfterCents),
    settlement: {
      mode: effectiveMode,
      refunded: fromCents(refundCents),
      credited: fromCents(creditedCents),
      payment_id: payment?.payment_id ?? null,
    },
    lines: prepared.map((p) => ({
      sale_line_id: Number(p.line.sale_line_id),
      returned_base_qty: Number(p.line.returned_base_qty),
      status: p.line.status,
      value: fromCents(p.value),
    })),
    _valueCents: valueCents,
    _customer: customer,
  };
};

// Fire and forget: a failed push never affects the return.
const announceReturn = (models, result, userId) => {
  void (async () => {
    try {
      const name = customerLabel(result._customer);
      await notifyEvent(models, "payment_voided", {
        amount: result.returned_value,
        actorUserId: userId,
        customerName: name,
        vars: {
          invoice_no: String(result.invoice_id),
          amount: result.returned_value,
          customer: name,
          reason: "Return",
          date: new Date(),
          time: new Date(),
        },
        title: `Return on bill #${result.invoice_id} · Rs ${formatLkr(result._valueCents)}`,
        body: `${name} · ${result.settlement.mode === "refund" ? "refunded" : "kept as credit"}`,
        titleNoAmount: `Return on bill #${result.invoice_id}`,
        bodyNoAmount: name,
        data: { type: "sale_return", invoice_id: String(result.invoice_id) },
        link: "/invoices?mode=manage",
      });
    } catch {
      // never affects the return
    }
  })();
};

/**
 * Find the bill when the customer has no receipt: recent sold lines that can still be returned,
 * newest first. Search by item words, customer name or phone, or bill number.
 */
export const findReturnableSales = async (
  models,
  { q = "", product_id = null, customer_id = null, days = 90, limit = 30, now = new Date() } = {},
) => {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 30);
  const safeDays = Math.min(Math.max(parseInt(days, 10) || 90, 1), 3650);
  const since = new Date(now.getTime() - safeDays * DAY_MS);
  const text = String(q || "").trim().slice(0, 80);

  const and = [
    { status: { [Op.ne]: "voided" } },
    models.sequelize.where(
      models.sequelize.col("InvoiceSaleLine.base_qty"),
      Op.gt,
      models.sequelize.col("InvoiceSaleLine.returned_base_qty"),
    ),
    { "$Invoice.issued_date$": { [Op.gte]: since } },
  ];
  if (product_id != null && product_id !== "") and.push({ product_id: Number(product_id) });
  if (customer_id != null && customer_id !== "") and.push({ "$Invoice.customer_id$": Number(customer_id) });

  if (text) {
    const like = (v) => ({ [Op.like]: `%${escapeLike(v)}%` });
    const words = text.split(/\s+/).filter(Boolean);
    const byItem = { [Op.and]: words.map((w) => ({ description: like(w) })) };
    const alts = [byItem];
    if (/^\d+$/.test(text)) alts.push({ invoice_id: Number(text) });
    alts.push({
      [Op.or]: [
        { "$Invoice.Customer.first_name$": like(text) },
        { "$Invoice.Customer.last_name$": like(text) },
        { "$Invoice.Customer.company_name$": like(text) },
        { "$Invoice.Customer.phone_number$": like(text) },
      ],
    });
    and.push({ [Op.or]: alts });
  }

  const rows = await models.InvoiceSaleLine.findAll({
    where: { [Op.and]: and },
    include: [
      {
        model: models.Invoice,
        required: true,
        attributes: ["invoice_id", "issued_date", "status", "bill_kind", "customer_id"],
        include: [
          {
            model: models.Customer,
            required: false,
            attributes: ["customer_id", "first_name", "last_name", "company_name", "customer_type", "phone_number", "is_walk_in"],
          },
        ],
      },
    ],
    order: [["sale_line_id", "DESC"]],
    limit: safeLimit,
  });

  return {
    items: rows.map((l) => {
      const inv = l.Invoice;
      const c = inv?.Customer;
      return {
        sale_line_id: Number(l.sale_line_id),
        invoice_id: Number(l.invoice_id),
        issued_date: inv?.issued_date ?? null,
        bill_status: inv?.status ?? null,
        customer_id: inv?.customer_id ?? null,
        customer_name: c?.is_walk_in ? "Walk-in customer" : customerLabel(c),
        customer_phone: c?.phone_number ?? null,
        is_walk_in: Boolean(c?.is_walk_in),
        product_id: l.product_id ?? null,
        description: l.description,
        unit_label: l.unit_label || "pcs",
        qty_sold: Number(l.qty),
        returnable_qty: returnableQty(l),
        returnable_base_qty: returnableBaseQty(l),
        unit_price: Number(l.unit_price),
        net_total: fromCents(lineNetCents(l)),
      };
    }),
  };
};
