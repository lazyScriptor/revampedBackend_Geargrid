import { Op } from "sequelize";
import AppError from "../../../utils/AppError.js";
import { addCents, fromCents, splitByWeight, toCents } from "../money.js";
import { getRetailSettings } from "../retailSettingsService.js";
import { consumeApprovalToken } from "../approvalService.js";
import { createProduct } from "../catalog/catalogService.js";
import {
  lockStockLevelsInOrder,
  postOpeningDocument,
  resolveWarehouseId,
  sell,
  voidSale,
} from "../stock/stockService.js";
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
    // Mixed bills: the machines' rental subtotal (rupees, before discount). The bill discount is
    // split between it and each sold line, and the discount limit is checked on the whole bill.
    rentalSubtotal = 0,
    approvalTokens = {},
    userId,
    effectivePermissions = null,
    warehouseId: requestedWarehouseId = null,
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
  // Every sale line records where it left from, so pick the warehouse before saving lines.
  const warehouseId = await resolveWarehouseId(models, requestedWarehouseId, settings, opts);
  const maxDiscountPct = Number(settings?.discountLimitPct ?? 10);

  const productIds = [
    ...new Set(saleItems.map((i) => Number(i?.product_id)).filter((id) => Number.isInteger(id) && id > 0)),
  ];
  const products =
    productIds.length > 0
      ? await models.RetailProduct.findAll({
          where: { product_id: { [Op.in]: productIds } },
          include: [{ model: models.RetailProductUnit, as: "Units", required: false }],
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

    // A catalogue line is stored as "item" (plan §4.3); "catalog" is accepted as another name for it.
    const rawKind = raw?.line_kind === "catalog" ? "item" : raw?.line_kind;
    const lineKind = rawKind || (raw?.product_id ? "item" : "unlisted");
    // Approvals can ride on each line (the counter sends them per line) or in the shared map.
    const lineTokens = raw?.approval_tokens && typeof raw.approval_tokens === "object" ? raw.approval_tokens : {};
    const lineEntry = (type, pid) =>
      lineTokens[type] ? { token: String(lineTokens[type]) } : resolveApprovalEntry(approvalTokens, type, pid);
    if (!["item", "unlisted", "sundry"].includes(lineKind)) {
      throw new AppError(`Invalid line_kind: ${lineKind}`, 400);
    }

    const lineDiscountCents = Math.max(0, toCents(raw?.line_discount ?? raw?.discount_amount ?? 0));

    if (lineKind === "item") {
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
        const units = product.Units || [];
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
        priceSource = "manual"; // an approved price change (plan §4.3)
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
        line_kind: "item",
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
  const rentalSubtotalCents = Math.max(0, toCents(rentalSubtotal || 0));
  const totalGrossCents = addCents(
    rentalSubtotalCents,
    preparedLines.reduce((acc, l) => addCents(acc, l.line_gross_cents), 0),
  );
  const totalLineDiscountCents = preparedLines.reduce((acc, l) => addCents(acc, l.line_discount_cents), 0);
  const saleSubtotalCents = preparedLines.reduce((acc, l) => addCents(acc, l.line_net_cents), 0);
  const subtotalCents = addCents(rentalSubtotalCents, saleSubtotalCents);

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

  // Weight 0 is the rental part (zero when there is no rental), then one weight per sold line.
  const allShares = splitByWeight(billDiscountCents, [
    rentalSubtotalCents,
    ...preparedLines.map((l) => l.line_net_cents),
  ]);
  const rentalDiscountShareCents = allShares[0] || 0;
  const billDiscountShares = allShares.slice(1);

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
        unit_label: String(line.unit_name || "pcs").slice(0, 20),
        unit_factor: line.unit_factor,
        base_qty: line.base_qty,
        unit_price: fromCents(line.unit_price_cents),
        price_source: line.price_source,
        line_discount: fromCents(line.line_discount_cents),
        bill_discount_share: fromCents(shareCents),
        line_total: fromCents(line.line_net_cents),
        unit_cost: line.unit_cost,
        cost_total: Math.round(Number(line.unit_cost || 0) * Number(line.base_qty || 0) * 100) / 100,
        warehouse_id: warehouseId ?? null,
        serial_number: line.serial_number,
        serial_no: line.serial_number != null && String(line.serial_number).trim() ? String(line.serial_number).trim().slice(0, 80) : null,
        status: "sold",
        note: line.note,
      },
      opts,
    );

    createdLines.push(created);

    if (line.line_kind === "item" && line.product_id) {
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

  const saleDiscountShareCents = billDiscountShares.reduce((acc, c) => addCents(acc, c), 0);
  const saleTotalCents = addCents(saleSubtotalCents, -saleDiscountShareCents);
  const grandTotalCents = addCents(subtotalCents, -billDiscountCents);
  return {
    saleLines: createdLines,
    // sub_total of the bill: rental subtotal + sold lines before the bill discount.
    subTotal: fromCents(subtotalCents),
    saleSubTotal: fromCents(saleSubtotalCents),
    discount: fromCents(billDiscountCents),
    // What the customer pays for the goods after their share of the discount.
    saleTotal: fromCents(saleTotalCents),
    // The part of the bill discount that falls on the machines (mixed bills only).
    rentalDiscountShare: fromCents(rentalDiscountShareCents),
    // Rental subtotal + goods − discount (transport is added by the caller).
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
      // Lines of a deleted bill are voided and leave the desk.
      status: { [Op.ne]: "voided" },
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

const TRACKED = new Set(["counted", "serial"]);
const DELETED_NOTE = "bill deleted";

/**
 * A bill is deleted: every sold line becomes 'voided' and its stock goes back on the shelf
 * (one SALE_VOID movement per counted or serial line, at the line's own cost). Unlisted lines that
 * were never sorted took no stock; their desk exceptions are declined.
 * A bill with any line already returned can't be deleted.
 */
export const voidForInvoice = async (models, invoiceId, { userId = null, transaction, now = new Date() } = {}) => {
  const opts = transaction ? { transaction } : {};
  const lines = await models.InvoiceSaleLine.findAll({
    where: { invoice_id: invoiceId },
    ...(transaction?.LOCK ? { lock: transaction.LOCK.UPDATE } : {}),
    ...opts,
  });

  if (lines.some((l) => Number(l.returned_base_qty || 0) > 0 || l.status === "returned" || l.status === "partly_returned")) {
    throw new AppError("Goods were returned on this bill, so it can't be deleted.", 409);
  }

  const soldLines = lines.filter((l) => l.status === "sold");
  if (soldLines.length === 0) return { voided_lines: 0, restocked_lines: 0 };

  const stockLines = soldLines.filter((l) => l.product_id);
  const { voided } = await voidSale(models, {
    lines: stockLines.map((l) => ({
      sale_line_id: l.sale_line_id,
      product_id: l.product_id,
      warehouse_id: l.warehouse_id,
      base_qty: l.base_qty,
      unit_cost: l.unit_cost,
      serial_no: l.serial_no,
    })),
    invoiceId,
    userId,
    occurredAt: now,
    now,
    transaction,
  });

  const lineIds = soldLines.map((l) => l.sale_line_id);
  await models.InvoiceSaleLine.update({ status: "voided" }, { where: { sale_line_id: { [Op.in]: lineIds } }, ...opts });

  // Unsorted unlisted lines: nothing to put back; the manager has nothing left to sort.
  const unsortedIds = soldLines
    .filter((l) => l.line_kind === "unlisted" && !l.sorted_at && !l.product_id)
    .map((l) => l.sale_line_id);
  if (unsortedIds.length > 0) {
    await models.CounterException.update(
      { status: "declined", note: DELETED_NOTE, resolved_at: now },
      {
        where: {
          sale_line_id: { [Op.in]: unsortedIds },
          type: "unlisted_item",
          status: { [Op.in]: ["recorded", "waiting", "approved"] },
        },
        ...opts,
      },
    );
  }

  return { voided_lines: lineIds.length, restocked_lines: voided.length };
};

/**
 * A bill is restored: the stock is taken again the way a sale takes it. Under the 'block' setting
 * the whole restore is refused if any item no longer has the stock; a serial that is no longer
 * in stock is always refused. Nothing changes when it is refused.
 */
export const restoreForInvoice = async (models, invoiceId, { userId = null, transaction, now = new Date() } = {}) => {
  const opts = transaction ? { transaction } : {};
  const lines = await models.InvoiceSaleLine.findAll({
    where: { invoice_id: invoiceId, status: "voided" },
    ...opts,
  });
  if (lines.length === 0) return { restored_lines: 0 };

  const stockLines = lines.filter((l) => l.product_id);
  const productIds = [...new Set(stockLines.map((l) => Number(l.product_id)))];
  const products = productIds.length
    ? await models.RetailProduct.findAll({ where: { product_id: { [Op.in]: productIds } }, ...opts })
    : [];
  const productsById = new Map(products.map((p) => [Number(p.product_id), p]));
  const tracked = stockLines.filter((l) => TRACKED.has(productsById.get(Number(l.product_id))?.tracking));

  if (tracked.length > 0) {
    const settings = await getRetailSettings(models);
    const levels = await lockStockLevelsInOrder(
      models,
      tracked.map((l) => ({ product_id: l.product_id, warehouse_id: l.warehouse_id })),
      { transaction },
    );

    // Serials must still be in stock, whatever the negative-stock setting says.
    for (const line of tracked) {
      const product = productsById.get(Number(line.product_id));
      if (product.tracking !== "serial") continue;
      const serialNo = line.serial_no ? String(line.serial_no) : null;
      if (!serialNo) continue;
      const serial = await models.RetailSerial.findOne({ where: { product_id: line.product_id, serial_no: serialNo }, ...opts });
      if (!serial || serial.status !== "in_stock" || Number(serial.warehouse_id) !== Number(line.warehouse_id)) {
        throw new AppError(`Cannot restore: serial ${serialNo} of ${product.name} is no longer in stock.`, 409);
      }
    }

    if ((settings?.negativeStock || "warn") === "block") {
      const need = new Map();
      for (const line of tracked) {
        const key = `${Number(line.product_id)}:${Number(line.warehouse_id)}`;
        need.set(key, round3((need.get(key) || 0) + Number(line.base_qty || 0)));
      }
      const shortages = [];
      for (const [key, qty] of need) {
        const level = levels.get(key);
        // Items not counted yet are never blocked.
        if (level?.counted_at === null || level?.counted_at === undefined) continue;
        const available = round3(Number(level?.qty_on_hand || 0));
        if (available < qty) {
          const product = productsById.get(Number(key.split(":")[0]));
          shortages.push(`${product?.name || `item ${key.split(":")[0]}`} (needs ${qty}, ${Math.max(0, available)} available)`);
        }
      }
      if (shortages.length > 0) {
        throw new AppError(`Cannot restore: not enough stock for ${shortages.join(", ")}.`, 409);
      }
    }

    // Every line goes back through sell(), from the warehouse it left from.
    const byWarehouse = new Map();
    for (const line of tracked) {
      const wid = Number(line.warehouse_id);
      if (!byWarehouse.has(wid)) byWarehouse.set(wid, []);
      byWarehouse.get(wid).push({
        sale_line_id: line.sale_line_id,
        product_id: line.product_id,
        base_qty: line.base_qty,
        serial_number: line.serial_no,
        unit_cost: line.unit_cost,
      });
    }
    for (const [wid, wlines] of byWarehouse) {
      await sell(models, { lines: wlines, warehouseId: wid, invoiceId, userId, occurredAt: now, transaction, now });
    }
  }

  const lineIds = lines.map((l) => l.sale_line_id);
  await models.InvoiceSaleLine.update({ status: "sold" }, { where: { sale_line_id: { [Op.in]: lineIds } }, ...opts });

  // Exceptions declined by the delete come back as they were.
  const exceptions = await models.CounterException.findAll({
    where: { sale_line_id: { [Op.in]: lineIds }, status: "declined", note: DELETED_NOTE },
    ...opts,
  });
  for (const ex of exceptions) {
    await ex.update({ status: ex.approved_by ? "approved" : "recorded", note: null, resolved_at: null }, opts);
  }

  return { restored_lines: lineIds.length };
};
