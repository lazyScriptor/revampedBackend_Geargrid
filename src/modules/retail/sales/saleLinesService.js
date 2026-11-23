import { Op } from "sequelize";
import AppError from "../../../utils/AppError.js";
import { addCents, fromCents, splitByWeight, toCents } from "../money.js";
import { getRetailSettings } from "../retailSettingsService.js";
import { consumeApprovalToken } from "../approvalService.js";
import { createProduct } from "../catalog/catalogService.js";
import { postOpeningDocument, sell } from "../stock/stockService.js";
import { userHasPermission } from "../../../services/userService.js";

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

const resolveApprovalEntry = (approvals, type, productId = null) => {
  if (!approvals) return null;
  if (Array.isArray(approvals)) {
    const match = approvals.find(
      (a) =>
        a &&
        a.type === type &&
        (productId == null || a.product_id == null || Number(a.product_id) === Number(productId)),
    );
    return match ? { token: match.token, context: match.context } : null;
  }
  if (productId != null && approvals[`${type}_by_product`]?.[productId]) {
    const entry = approvals[`${type}_by_product`][productId];
    return typeof entry === "string" ? { token: entry } : entry;
  }
  const entry = approvals[type];
  if (!entry) return null;
  return typeof entry === "string" ? { token: entry } : entry;
};

const hasPermission = async (models, effectivePermissions, userId, permissionCode, transaction) => {
  if (Array.isArray(effectivePermissions)) {
    return effectivePermissions.includes(permissionCode) || effectivePermissions.includes("*");
  }
  if (effectivePermissions instanceof Set) {
    return effectivePermissions.has(permissionCode) || effectivePermissions.has("*");
  }
  return userHasPermission(models, userId, permissionCode, transaction);
};

const resolveServerUnitPriceCents = (product, unit, customer) => {
  const factor = unit ? Number(unit.factor) : 1;
  const priceLevel = customer?.price_level || "retail";

  if (priceLevel === "contractor" && product.contractor_price != null) {
    return {
      unitPriceCents: Math.round(toCents(product.contractor_price) * factor),
      priceSource: "contractor",
    };
  }
  if (priceLevel === "trade" && product.trade_price != null) {
    return {
      unitPriceCents: Math.round(toCents(product.trade_price) * factor),
      priceSource: "trade",
    };
  }
  if (unit && unit.sell_price != null) {
    return {
      unitPriceCents: toCents(unit.sell_price),
      priceSource: "pack",
    };
  }
  return {
    unitPriceCents: Math.round(toCents(product.sell_price) * factor),
    priceSource: "retail",
  };
};

/**
 * Price, validate, persist INVOICE_SALE_LINES, record counter exceptions,
 * and deduct stock via stockService.sell() inside the active transaction.
 */
export const createSaleBillLinesAndTotals = async (
  models,
  {
    invoiceId,
    customer,
    saleItems = [],
    billDiscountAmount = 0,
    approvalTokens = {},
    userId,
    effectivePermissions = null,
    warehouseId = null,
    occurredAt = new Date(),
    transaction,
    now = new Date(),
  },
) => {
  if (!Array.isArray(saleItems) || saleItems.length === 0) {
    throw new AppError("sale_items must be a non-empty array.", 400);
  }

  const opts = transaction ? { transaction } : {};
  const settings = await getRetailSettings(models);
  const maxDiscountPct = Number(settings?.discountLimitPct ?? 10);

  const productIds = [
    ...new Set(saleItems.map((i) => Number(i?.product_id)).filter((id) => Number.isInteger(id) && id > 0)),
  ];
  const products =
    productIds.length > 0
      ? await models.RetailProduct.findAll({
          where: { product_id: { [Op.in]: productIds } },
          include: [{ model: models.RetailProductUnit, required: false }],
          ...opts,
        })
      : [];
  const productsById = new Map(products.map((p) => [Number(p.product_id), p]));

  const consumedTokens = new Map();
  const consumeOnce = async (type, entry, defaultContext) => {
    if (!entry?.token) return null;
    if (consumedTokens.has(entry.token)) {
      return consumedTokens.get(entry.token);
    }
    const consumed = await consumeApprovalToken(models, entry.token, {
      type,
      ...(typeof defaultContext === "function" ? { verify: defaultContext } : { context: entry.context ?? defaultContext }),
      userId,
      transaction,
      now,
    });
    consumedTokens.set(entry.token, consumed);
    return consumed;
  };

  const priceChanges = [];
  const preparedLines = [];
  const pendingExceptions = [];

  for (const raw of saleItems) {
    const qty = round3(Number(raw?.qty));
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new AppError("Each sale item must have a positive qty.", 400);
    }

    // The counter calls a catalogue line "item" (plan §4.3); stored as "catalog".
    const rawKind = raw?.line_kind === "item" ? "catalog" : raw?.line_kind;
    const lineKind = rawKind || (raw?.product_id ? "catalog" : "unlisted");
    // Approvals can ride on each line (the counter sends them per line) or in the shared map.
    const lineTokens = raw?.approval_tokens && typeof raw.approval_tokens === "object" ? raw.approval_tokens : {};
    const lineEntry = (type, pid) =>
      lineTokens[type] ? { token: String(lineTokens[type]) } : resolveApprovalEntry(approvalTokens, type, pid);
    if (!["catalog", "unlisted", "sundry"].includes(lineKind)) {
      throw new AppError(`Invalid line_kind: ${lineKind}`, 400);
    }

    const lineDiscountCents = Math.max(0, toCents(raw?.line_discount ?? raw?.discount_amount ?? 0));

    if (lineKind === "catalog") {
      const pid = Number(raw?.product_id);
      const product = productsById.get(pid);
      if (!product) {
        throw new AppError(`Product ${raw?.product_id} not found.`, 404);
      }

      if (!product.allow_decimal && Math.abs(qty - Math.round(qty)) > 1e-6) {
        throw new AppError(`Product ${product.name} does not allow decimal quantities.`, 400);
      }

      let unit = null;
      if (raw?.unit_id != null) {
        const units = product.RetailProductUnits || [];
        unit = units.find((u) => Number(u.unit_id) === Number(raw.unit_id));
        if (!unit) {
          throw new AppError(`Unit ${raw.unit_id} does not belong to product ${pid}.`, 400);
        }
      }

      const unitFactor = unit ? Number(unit.factor) : 1;
      const unitName = unit ? unit.unit_name : product.base_unit;
      const baseQty = round3(qty * unitFactor);

      const { unitPriceCents: serverUnitPriceCents, priceSource: defaultPriceSource } =
        resolveServerUnitPriceCents(product, unit, customer);

      let finalUnitPriceCents = serverUnitPriceCents;
      let priceSource = defaultPriceSource;

      // 1. Check stale expected_unit_price from client cache
      if (raw?.expected_unit_price != null) {
        const expectedCents = toCents(raw.expected_unit_price);
        if (expectedCents !== serverUnitPriceCents && raw?.unit_price == null) {
          priceChanges.push({
            product_id: pid,
            unit_id: unit ? Number(unit.unit_id) : null,
            expected_unit_price: fromCents(expectedCents),
            current_unit_price: fromCents(serverUnitPriceCents),
            price_source: defaultPriceSource,
          });
          continue;
        }
      }

      // 2. Check explicit price override
      if (raw?.unit_price != null && toCents(raw.unit_price) !== serverUnitPriceCents) {
        const overrideCents = toCents(raw.unit_price);
        if (overrideCents < 0) {
          throw new AppError("Unit price cannot be negative.", 400);
        }
        const entry = lineEntry("price_change", pid);
        if (!entry?.token) {
          priceChanges.push({
            product_id: pid,
            unit_id: unit ? Number(unit.unit_id) : null,
            requested_unit_price: fromCents(overrideCents),
            current_unit_price: fromCents(serverUnitPriceCents),
            price_source: defaultPriceSource,
          });
          continue;
        }
        // The manager approved this item at this new price (the counter's context: product_id, unit_id, from, to).
        const consumed = await consumeOnce("price_change", entry, (ctx) =>
          Number(ctx.product_id) === Number(pid) &&
          toCents(ctx.to ?? ctx.unit_price) === overrideCents &&
          (ctx.unit_id == null || unit == null || Number(ctx.unit_id) === Number(unit.unit_id)),
        );
        finalUnitPriceCents = overrideCents;
        priceSource = "approved_override";
        pendingExceptions.push({
          type: "price_change",
          status: "approved",
          product_id: pid,
          approved_by: consumed.approver_user_id,
          approved_at: now,
          old_value: { unit_price: fromCents(serverUnitPriceCents) },
          new_value: { unit_price: fromCents(overrideCents) },
          amount_impact: fromCents(Math.round((overrideCents - serverUnitPriceCents) * qty)),
          summary: `Price changed for ${product.name}: ${fromCents(serverUnitPriceCents)} -> ${fromCents(overrideCents)}`,
        });
      }

      const lineGrossCents = Math.round(finalUnitPriceCents * qty);
      const lineNetCents = Math.max(0, lineGrossCents - lineDiscountCents);
      const unitCost = Number(product.avg_cost || 0);

      preparedLines.push({
        line_kind: "catalog",
        product_id: pid,
        description: product.name,
        qty,
        unit_id: unit ? Number(unit.unit_id) : null,
        unit_name: unitName,
        unit_factor: unitFactor,
        base_qty: baseQty,
        unit_price_cents: finalUnitPriceCents,
        price_source: priceSource,
        line_discount_cents: lineDiscountCents,
        line_gross_cents: lineGrossCents,
        line_net_cents: lineNetCents,
        unit_cost: unitCost,
        serial_number: (() => {
          // The counter sends serials as a list; one serial-numbered unit per line.
          if (Array.isArray(raw?.serials) && raw.serials.length > 1) {
            throw new AppError("Sell serial-numbered items one per line.", 400);
          }
          return raw?.serial_number ?? raw?.serial_no ?? (Array.isArray(raw?.serials) ? raw.serials[0] ?? null : null);
        })(),
        approval_tokens: lineTokens,
        note: raw?.note ?? null,
      });
    } else {
      // unlisted or sundry
      const description = String(raw?.description || raw?.name || "").trim();
      if (!description) {
        throw new AppError("Description is required for unlisted or sundry lines.", 400);
      }
      const unitPriceCents = toCents(raw?.unit_price);
      if (unitPriceCents < 0) {
        throw new AppError("Unit price cannot be negative.", 400);
      }

      const canSellUnlisted = await hasPermission(
        models,
        effectivePermissions,
        userId,
        "retail:add_unlisted",
        transaction,
      );
      let exceptionStatus = "recorded";
      let approvedBy = null;
      let approvedAt = null;

      if (!canSellUnlisted) {
        const entry = lineEntry("unlisted_item", null);
        if (!entry?.token) {
          const err = new AppError(
            "Selling unlisted or sundry items requires permission or manager approval.",
            403,
          );
          err.code = "unlisted_approval_required";
          throw err;
        }
        const consumed = await consumeOnce("unlisted_item", entry, (ctx) =>
          String(ctx.description ?? "").trim().toLowerCase() === description.toLowerCase() &&
          (ctx.unit_price == null || toCents(ctx.unit_price) === toCents(raw?.unit_price)),
        );
        exceptionStatus = "approved";
        approvedBy = consumed.approver_user_id;
        approvedAt = now;
      }

      const lineGrossCents = Math.round(unitPriceCents * qty);
      const lineNetCents = Math.max(0, lineGrossCents - lineDiscountCents);

      preparedLines.push({
        line_kind: lineKind,
        product_id: null,
        description,
        qty,
        unit_id: null,
        unit_name: String(raw?.unit_name || "pcs").slice(0, 20),
        unit_factor: 1,
        base_qty: qty,
        unit_price_cents: unitPriceCents,
        price_source: "manual",
        line_discount_cents: lineDiscountCents,
        line_gross_cents: lineGrossCents,
        line_net_cents: lineNetCents,
        unit_cost: Number(raw?.unit_cost || 0),
        serial_number: null,
        note: raw?.note ?? null,
        unlistedException: {
          type: "unlisted_item",
          status: exceptionStatus,
          approved_by: approvedBy,
          approved_at: approvedAt,
          new_value: { line_kind: lineKind, description, qty, unit_price: fromCents(unitPriceCents) },
          amount_impact: fromCents(lineNetCents),
          summary: `${lineKind === "sundry" ? "Sundry" : "Unlisted"} item sold: ${description}`,
        },
      });
    }
  }

  if (priceChanges.length > 0) {
    const err = new AppError("Price changed or requires manager approval.", 409);
    err.code = "price_changed";
    err.data = { code: "price_changed", current_prices: priceChanges };
    throw err;
  }

  const billDiscountCents = Math.max(0, toCents(billDiscountAmount || 0));
  const totalGrossCents = preparedLines.reduce((acc, l) => addCents(acc, l.line_gross_cents), 0);
  const totalLineDiscountCents = preparedLines.reduce((acc, l) => addCents(acc, l.line_discount_cents), 0);
  const subtotalCents = preparedLines.reduce((acc, l) => addCents(acc, l.line_net_cents), 0);

  if (billDiscountCents > subtotalCents) {
    throw new AppError("Bill discount cannot exceed subtotal.", 400);
  }

  const totalDiscountCents = addCents(totalLineDiscountCents, billDiscountCents);
  const discountPct = totalGrossCents > 0 ? (totalDiscountCents / totalGrossCents) * 100 : 0;

  if (discountPct > maxDiscountPct) {
    // Discount approvals may come per line and for the bill; together they must cover the total
    // discount actually given (each approval's context carries the amount the manager approved).
    const discountTokens = new Set();
    const shared = resolveApprovalEntry(approvalTokens, "discount_over_limit", null);
    if (shared?.token) discountTokens.add(String(shared.token));
    for (const raw of saleItems) {
      const t = raw?.approval_tokens?.discount_over_limit;
      if (t) discountTokens.add(String(t));
    }
    const entry = discountTokens.size ? { token: [...discountTokens][0] } : null;
    if (!entry?.token) {
      const err = new AppError(
        `Discount (${discountPct.toFixed(2)}%) exceeds cashier limit (${maxDiscountPct}%) and requires manager approval.`,
        403,
      );
      err.code = "discount_over_limit";
      err.data = {
        code: "discount_over_limit",
        max_discount_pct: maxDiscountPct,
        requested_discount_pct: Number(discountPct.toFixed(2)),
      };
      throw err;
    }
    let approvedCents = 0;
    let consumed = null;
    for (const token of discountTokens) {
      consumed = await consumeOnce("discount_over_limit", { token }, (ctx) => {
        approvedCents += toCents(ctx.discount ?? ctx.discount_amount ?? 0);
        return true;
      });
    }
    if (approvedCents + 1 < totalDiscountCents) {
      const err = new AppError(
        `The approved discount (Rs ${fromCents(approvedCents)}) is less than the discount given (Rs ${fromCents(totalDiscountCents)}).`,
        403,
      );
      err.code = "discount_over_limit";
      err.data = { code: "discount_over_limit", approved: fromCents(approvedCents), requested: fromCents(totalDiscountCents) };
      throw err;
    }
    pendingExceptions.push({
      type: "discount_over_limit",
      status: "approved",
      approved_by: consumed.approver_user_id,
      approved_at: now,
      new_value: {
        discount_pct: Number(discountPct.toFixed(2)),
        discount_amount: fromCents(totalDiscountCents),
        max_discount_pct: maxDiscountPct,
      },
      amount_impact: fromCents(totalDiscountCents),
      summary: `Discount ${discountPct.toFixed(1)}% (${fromCents(totalDiscountCents)}) approved over ${maxDiscountPct}% limit`,
    });
  }

  const billDiscountShares = splitByWeight(
    billDiscountCents,
    preparedLines.map((l) => l.line_net_cents),
  );

  const createdLines = [];
  const catalogLinesToSell = [];

  for (let i = 0; i < preparedLines.length; i += 1) {
    const line = preparedLines[i];
    const shareCents = billDiscountShares[i] || 0;

    const created = await models.InvoiceSaleLine.create(
      {
        invoice_id: invoiceId,
        line_kind: line.line_kind,
        product_id: line.product_id,
        description: line.description,
        qty: line.qty,
        unit_id: line.unit_id,
        unit_name: line.unit_name,
        unit_factor: line.unit_factor,
        base_qty: line.base_qty,
        unit_price: fromCents(line.unit_price_cents),
        price_source: line.price_source,
        line_discount: fromCents(line.line_discount_cents),
        bill_discount_share: fromCents(shareCents),
        line_total: fromCents(line.line_net_cents),
        unit_cost: line.unit_cost,
        warehouse_id: warehouseId ?? null,
        serial_number: line.serial_number,
        status: "sold",
        note: line.note,
      },
      opts,
    );

    createdLines.push(created);

    if (line.line_kind === "catalog" && line.product_id) {
      catalogLinesToSell.push({
        sale_line_id: created.sale_line_id,
        product_id: line.product_id,
        base_qty: line.base_qty,
        serial_number: line.serial_number,
        unit_cost: line.unit_cost,
      });
    }

    if (line.unlistedException) {
      await models.CounterException.create(
        {
          ...line.unlistedException,
          invoice_id: invoiceId,
          sale_line_id: created.sale_line_id,
          requested_by: userId,
          created_at: now,
        },
        opts,
      );
    }
  }

  for (const ex of pendingExceptions) {
    await models.CounterException.create(
      {
        ...ex,
        invoice_id: invoiceId,
        requested_by: userId,
        created_at: now,
      },
      opts,
    );
  }

  let sellResult = { sold: [], warehouse_id: warehouseId ?? null };
  if (catalogLinesToSell.length > 0) {
    sellResult = await sell(models, {
      lines: catalogLinesToSell,
      warehouseId,
      invoiceId,
      userId,
      occurredAt,
      approvals: (() => {
        // Per-line "sell anyway" approvals, keyed by product for the stock engine.
        const merged = { ...(approvalTokens || {}) };
        for (const raw of saleItems) {
          const t = raw?.approval_tokens?.negative_stock;
          if (t && raw?.product_id) {
            merged.negative_stock_by_product = { ...(merged.negative_stock_by_product || {}), [Number(raw.product_id)]: String(t) };
          }
        }
        return merged;
      })(),
      transaction,
      now,
    });
  }

  const grandTotalCents = addCents(subtotalCents, -billDiscountCents);
  return {
    saleLines: createdLines,
    subTotal: fromCents(subtotalCents),
    discount: fromCents(billDiscountCents),
    totalAmount: fromCents(grandTotalCents),
    warehouseId: sellResult.warehouse_id,
  };
};

/**
 * Fetch open unlisted sale lines for Manager Desk "To sort" tab.
 */
export const getToSortDeskItems = async (models, { page = 1, limit = 20 } = {}) => {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const offset = (safePage - 1) * safeLimit;

  const { rows, count } = await models.InvoiceSaleLine.findAndCountAll({
    where: {
      line_kind: "unlisted",
      sorted_at: null,
    },
    include: [
      {
        model: models.Invoice,
        attributes: ["invoice_id", "invoice_number", "issued_date", "customer_id"],
        required: false,
      },
    ],
    order: [["sale_line_id", "DESC"]],
    limit: safeLimit,
    offset,
  });

  return {
    items: rows,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: count,
      totalPages: Math.max(Math.ceil(count / safeLimit), 1),
    },
  };
};

const normalizeSaleLineIds = (saleLineIds) => {
  const ids = [...new Set((Array.isArray(saleLineIds) ? saleLineIds : [saleLineIds]).map(Number))].filter(
    (id) => Number.isInteger(id) && id > 0,
  );
  if (ids.length === 0) {
    throw new AppError("sale_line_ids must be a non-empty array.", 400);
  }
  return ids;
};

/**
 * Link one or more unlisted sale lines to an existing catalog product.
 */
export const linkUnlistedSaleLines = async (
  models,
  { saleLineIds, productId, userId, warehouseId = null, approvals = {} },
) => {
  const ids = normalizeSaleLineIds(saleLineIds);
  const pid = Number(productId);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new AppError("product_id is required.", 400);
  }

  return models.sequelize.transaction(async (transaction) => {
    const product = await models.RetailProduct.findByPk(pid, { transaction });
    if (!product) {
      throw new AppError(`Product ${pid} not found.`, 404);
    }

    const lines = await models.InvoiceSaleLine.findAll({
      where: { sale_line_id: { [Op.in]: ids }, line_kind: "unlisted" },
      include: [
        {
          model: models.Invoice,
          attributes: ["invoice_id", "issued_date"],
          required: false,
        },
      ],
      transaction,
    });
    if (lines.length === 0) {
      throw new AppError("No matching unlisted sale lines found.", 404);
    }

    const now = new Date();
    const unitCost = Number(product.avg_cost || 0);
    await models.InvoiceSaleLine.update(
      {
        product_id: pid,
        unit_cost: unitCost,
        sorted_at: now,
        sorted_by: userId,
      },
      {
        where: { sale_line_id: { [Op.in]: lines.map((l) => l.sale_line_id) } },
        transaction,
      },
    );

    if (product.tracking === "counted" || product.tracking === "serial") {
      for (const line of lines) {
        await sell(models, {
          lines: [
            {
              sale_line_id: line.sale_line_id,
              product_id: pid,
              base_qty: line.base_qty,
              serial_number: line.serial_number,
              unit_cost: unitCost,
            },
          ],
          warehouseId: line.warehouse_id ?? warehouseId,
          invoiceId: line.invoice_id,
          userId,
          occurredAt: line.Invoice?.issued_date || now,
          approvals,
          transaction,
          now,
        });
      }
    }

    return {
      linked_count: lines.length,
      product_id: pid,
      sale_line_ids: lines.map((l) => l.sale_line_id),
    };
  });
};

/**
 * Create a new catalog product (created_via='from_unlisted'), optionally post opening stock,
 * and link unlisted sale lines to it.
 */
export const createAndLinkUnlistedSaleLines = async (
  models,
  { saleLineIds, productPayload = {}, openingQty = null, openingCost = null, warehouseId = null, userId, approvals = {} },
) => {
  const ids = normalizeSaleLineIds(saleLineIds);
  const product = await createProduct(models, userId, {
    ...productPayload,
    created_via: "from_unlisted",
  });

  if (openingQty != null && Number(openingQty) > 0) {
    await postOpeningDocument(models, userId, {
      warehouse_id: warehouseId ?? productPayload?.warehouse_id ?? null,
      lines: [
        {
          product_id: product.product_id,
          qty: Number(openingQty),
          unit_cost: Number(openingCost ?? productPayload?.avg_cost ?? productPayload?.last_cost ?? 0),
        },
      ],
      note: "Opening stock created from To Sort desk",
    });
  }

  const linkResult = await linkUnlistedSaleLines(models, {
    saleLineIds: ids,
    productId: product.product_id,
    userId,
    warehouseId: warehouseId ?? productPayload?.warehouse_id ?? null,
    approvals,
  });

  return {
    product,
    ...linkResult,
  };
};

/**
 * Mark unlisted sale lines as one-off (clears them from the To Sort desk).
 */
export const markUnlistedOneOff = async (models, { saleLineIds, userId }) => {
  const ids = normalizeSaleLineIds(saleLineIds);
  const now = new Date();
  const [updated] = await models.InvoiceSaleLine.update(
    {
      sorted_at: now,
      sorted_by: userId,
    },
    {
      where: {
        sale_line_id: { [Op.in]: ids },
        line_kind: "unlisted",
        sorted_at: null,
      },
    },
  );
  if (updated === 0) {
    throw new AppError("No open unlisted sale lines found.", 404);
  }
  return { marked_count: updated, sale_line_ids: ids };
};
