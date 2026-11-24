import AppError from "../../../utils/AppError.js";
import { parseJsonField } from "../../../utils/jsonFields.js";

// A bill's returns of sold goods, read back from the SALE_RETURN traces (R5 writes one per return).
// Used by the return slip and by the bill's history. The trace id is the return's id.

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const personName = (u) => {
  if (!u) return null;
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return full || u.username || null;
};

/** One trace -> the shape the slip needs. Older traces may lack fields; the sale line fills them in. */
export const shapeSaleReturn = (trace, { saleLineById = new Map(), userById = new Map(), productById = new Map() } = {}) => {
  const payload = parseJsonField(trace.state_payload, {}) || {};
  const settlement = parseJsonField(payload.settlement, {}) || {};
  const lines = (Array.isArray(payload.lines) ? payload.lines : []).map((l) => {
    const sale = saleLineById.get(Number(l.sale_line_id)) || {};
    // R5's first traces wrote "base" for a return counted in the item's smallest unit: name that unit
    let unit = l.unit_label || l.unit || sale.unit_label || "";
    if (unit === "base") unit = productById.get(Number(sale.product_id))?.base_unit || "pcs";
    return {
      sale_line_id: l.sale_line_id === undefined || l.sale_line_id === null ? null : Number(l.sale_line_id),
      description: l.description || sale.description || "",
      qty: num(l.qty),
      unit_label: unit,
      condition: l.condition || "good",
      value: num(l.value),
    };
  });
  const value = payload.value !== undefined && payload.value !== null ? num(payload.value) : lines.reduce((s, l) => s + l.value, 0);
  return {
    return_id: Number(trace.trace_id),
    returned_at: trace.occurred_at || trace.createdAt || null,
    cashier: personName(userById.get(Number(trace.actor_user_id))),
    lines,
    value,
    settlement: {
      mode: settlement.mode ?? null,
      refunded: num(settlement.refunded),
      credited: num(settlement.credited),
      method: settlement.method ?? null,
    },
    reason: payload.reason ?? null,
    balance_after: payload.balance_after === undefined || payload.balance_after === null ? null : num(payload.balance_after),
  };
};

/** GET /api/invoices/:id/sale-returns. Newest first. */
export const listSaleReturns = async (models, invoiceId) => {
  const id = Number(invoiceId);
  const invoice = await models.Invoice.findByPk(id);
  if (!invoice) throw new AppError("Invoice not found", 404);

  const traces = await models.InvoiceTrace.findAll({
    where: { invoice_id: id, event_category: "RETAIL", event_action: "SALE_RETURN" },
    order: [["createdAt", "DESC"], ["trace_id", "DESC"]],
  });
  if (!traces.length) return [];

  const actorIds = [...new Set(traces.map((t) => Number(t.actor_user_id)).filter((n) => n > 0))];
  const [users, saleLines] = await Promise.all([
    actorIds.length && models.User?.findAll
      ? models.User.findAll({ where: { user_id: actorIds }, attributes: ["user_id", "first_name", "last_name", "username"] })
      : [],
    models.InvoiceSaleLine?.findAll ? models.InvoiceSaleLine.findAll({ where: { invoice_id: id } }) : [],
  ]);
  const userById = new Map(users.map((u) => [Number(u.user_id), u]));
  const saleLineById = new Map(saleLines.map((l) => [Number(l.sale_line_id), l]));
  const productIds = [...new Set(saleLines.map((l) => Number(l.product_id)).filter((n) => n > 0))];
  const products = productIds.length && models.RetailProduct?.findAll
    ? await models.RetailProduct.findAll({ where: { product_id: productIds }, attributes: ["product_id", "base_unit"] })
    : [];
  const productById = new Map(products.map((p) => [Number(p.product_id), p]));

  return traces
    .map((t) => shapeSaleReturn(t, { saleLineById, userById, productById }))
    .sort((a, b) => new Date(b.returned_at || 0) - new Date(a.returned_at || 0) || b.return_id - a.return_id);
};

export const findSaleReturn = async (models, invoiceId, returnId) => {
  const all = await listSaleReturns(models, invoiceId);
  return all.find((r) => r.return_id === Number(returnId)) || null;
};
