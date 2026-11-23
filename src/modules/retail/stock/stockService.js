import { Op } from "sequelize";
import AppError from "../../../utils/AppError.js";
import { parseJsonField } from "../../../utils/jsonFields.js";
import { addCents, fromCents, splitByWeight, toCents } from "../money.js";
import { getRetailSettings } from "../retailSettingsService.js";
import { consumeApprovalToken, recordCounterException } from "../approvalService.js";
import { escapeLike } from "../catalog/naming.js";

export const ADJUST_REASONS = ["damaged", "lost", "own_use", "sample", "found", "other"];
const DOC_PREFIXES = {
  receive: "RCV-",
  adjust: "ADJ-",
  count: "CNT-",
  opening: "OPN-",
  transfer: "TRF-",
};
const ADMIN_ROLE_NAMES = new Set(["admin", "owner", "superadmin", "super_admin"]);

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

const dayInShopTz = (date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const runInTransaction = async (models, fn) => {
  if (models?.sequelize?.transaction) {
    return models.sequelize.transaction(fn);
  }
  return fn(undefined);
};

const isUniqueError = (err) =>
  err?.name === "SequelizeUniqueConstraintError" ||
  err?.original?.code === "ER_DUP_ENTRY" ||
  err?.parent?.code === "ER_DUP_ENTRY";

const userHasPermission = async (models, userId, permissionCode, effectivePermissions = null) => {
  if (effectivePermissions?.has("*")) return true;
  if (effectivePermissions?.has(permissionCode)) return true;
  if (!userId || !models?.User?.findByPk) return false;

  const user = await models.User.findByPk(userId, {
    include: [
      {
        model: models.Role,
        include: [
          {
            model: models.Permission,
            attributes: ["permission_id", "permission_code"],
            through: { attributes: [] },
          },
        ],
        attributes: ["role_id", "role_name", "hierarchy_level"],
      },
    ],
  });
  if (!user) return false;

  const effective = new Set();
  for (const role of user.Roles || []) {
    if (Number(role.hierarchy_level || 0) >= 100) return true;
    if (ADMIN_ROLE_NAMES.has(String(role.role_name || "").toLowerCase().trim())) return true;
    for (const perm of role.Permissions || []) {
      effective.add(perm.permission_code);
    }
  }

  if (models.UserPermissionOverride?.findAll) {
    const overrides = await models.UserPermissionOverride.findAll({
      where: { user_id: userId },
      include: [{ model: models.Permission, attributes: ["permission_code"] }],
    });
    for (const ov of overrides || []) {
      const code = ov.Permission?.permission_code || ov.permission_code;
      if (!code) continue;
      if (ov.grant_type === "grant") effective.add(code);
      else if (ov.grant_type === "revoke") effective.delete(code);
    }
  }

  return effective.has(permissionCode);
};

export const resolveWarehouseId = async (models, requestedId, settings, { transaction } = {}) => {
  const opts = transaction ? { transaction } : {};
  const candidate = requestedId ?? settings?.defaultWarehouseId ?? null;
  if (candidate) {
    const wh = await models.Warehouse.findByPk(Number(candidate), opts);
    if (!wh) throw new AppError("Warehouse not found.", 404);
    return Number(wh.warehouse_id);
  }
  const defaultWh = await models.Warehouse.findOne({ order: [["warehouse_id", "ASC"]], ...opts });
  if (!defaultWh) throw new AppError("No warehouse configured.", 400);
  return Number(defaultWh.warehouse_id);
};

const validateOccurredAt = async (
  models,
  rawOccurredAt,
  { userId, effectivePermissions, settings, now = new Date() },
) => {
  const occurredAt = rawOccurredAt ? new Date(rawOccurredAt) : now;
  if (Number.isNaN(occurredAt.getTime())) {
    throw new AppError("Invalid occurred_at date.", 400);
  }
  if (occurredAt.getTime() > now.getTime() + 60_000) {
    throw new AppError("occurred_at cannot be in the future.", 400);
  }
  if (settings?.booksClosedUntil) {
    const occurredDay = dayInShopTz(occurredAt);
    if (occurredDay <= settings.booksClosedUntil) {
      throw new AppError(
        `Books are closed until ${settings.booksClosedUntil}. Cannot post stock changes on or before that date.`,
        422,
      );
    }
  }
  if (now.getTime() - occurredAt.getTime() > 24 * 60 * 60 * 1000) {
    const allowed = await userHasPermission(models, userId, "retail:backdate", effectivePermissions);
    if (!allowed) {
      throw new AppError("Back-dating stock documents more than 24 hours requires retail:backdate.", 403);
    }
  }
  return occurredAt;
};

const nextDocNo = async (models, docType, { transaction } = {}) => {
  const prefix = DOC_PREFIXES[docType] || "STK-";
  const rows = await models.RetailStockDocument.findAll({
    where: { doc_type: docType, doc_no: { [Op.like]: `${prefix}%` } },
    attributes: ["doc_no"],
    raw: true,
    ...(transaction ? { transaction } : {}),
  });
  let maxNum = 0;
  for (const r of rows || []) {
    const s = String(r.doc_no || "");
    if (!s.startsWith(prefix)) continue;
    const suffix = s.slice(prefix.length);
    if (/^\d+$/.test(suffix)) {
      const n = Number(suffix);
      if (n > maxNum) maxNum = n;
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(5, "0")}`;
};

const createDocumentWithRetry = async (models, payload, { transaction } = {}) => {
  const opts = transaction ? { transaction } : {};
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const docNo = await nextDocNo(models, payload.doc_type, opts);
      return await models.RetailStockDocument.create({ ...payload, doc_no: docNo }, opts);
    } catch (err) {
      lastErr = err;
      if (!isUniqueError(err) || attempt === 5) throw err;
    }
  }
  throw lastErr;
};

const assertTrackableProducts = async (models, productIds, { transaction } = {}) => {
  const opts = transaction ? { transaction } : {};
  const uniqueIds = [...new Set(productIds.map(Number))].sort((a, b) => a - b);
  const products = await models.RetailProduct.findAll({
    where: { product_id: { [Op.in]: uniqueIds } },
    include: [{ model: models.RetailProductUnit, as: "Units" }],
    ...opts,
  });
  const byId = new Map(products.map((p) => [Number(p.product_id), p]));
  for (const pid of uniqueIds) {
    const p = byId.get(pid);
    if (!p) throw new AppError(`Product ${pid} not found.`, 404);
    if (p.tracking === "untracked" || p.tracking === "service") {
      throw new AppError(
        `Product "${p.name}" has tracking="${p.tracking}" and does not track stock.`,
        422,
      );
    }
  }
  return byId;
};

/**
 * Lock or insert RETAIL_STOCK_LEVELS rows in strict (product_id ASC, warehouse_id ASC) order
 * so concurrent transactions never deadlock.
 */
const lockStockLevelsInOrder = async (models, pairs, { transaction } = {}) => {
  const opts = transaction ? { transaction } : {};
  const uniqueMap = new Map();
  for (const { product_id, warehouse_id } of pairs) {
    const pid = Number(product_id);
    const wid = Number(warehouse_id);
    uniqueMap.set(`${pid}:${wid}`, { product_id: pid, warehouse_id: wid });
  }
  const sorted = [...uniqueMap.values()].sort(
    (a, b) => a.product_id - b.product_id || a.warehouse_id - b.warehouse_id,
  );

  const locked = new Map();
  const lockMode = transaction && models.sequelize?.constructor?.Transaction?.LOCK?.UPDATE;

  for (const { product_id, warehouse_id } of sorted) {
    let row = await models.RetailStockLevel.findOne({
      where: { product_id, warehouse_id },
      ...(lockMode ? { lock: lockMode } : {}),
      ...opts,
    });
    if (!row) {
      try {
        row = await models.RetailStockLevel.create(
          { product_id, warehouse_id, qty_on_hand: 0, counted_at: null },
          opts,
        );
      } catch (err) {
        if (!isUniqueError(err)) throw err;
      }
      row = await models.RetailStockLevel.findOne({
        where: { product_id, warehouse_id },
        ...(lockMode ? { lock: lockMode } : {}),
        ...opts,
      });
    }
    locked.set(`${product_id}:${warehouse_id}`, row);
  }
  return locked;
};

/**
 * Single checked stock-level mutation + insert-only movement creation.
 */
const applyStockChange = async (
  models,
  {
    product_id,
    warehouse_id,
    delta,
    setExactQty = null,
    markCountedAt = null,
    allowNegative = true,
    movementType,
    reason = null,
    unit_cost = 0,
    doc_id = null,
    sale_line_id = null,
    user_id = null,
    occurred_at = new Date(),
    now = new Date(),
    transaction,
  },
) => {
  const opts = transaction ? { transaction } : {};
  const pid = Number(product_id);
  const wid = Number(warehouse_id);

  if (setExactQty !== null && setExactQty !== undefined) {
    const targetQty = round3(setExactQty);
    await models.RetailStockLevel.update(
      {
        qty_on_hand: targetQty,
        ...(markCountedAt ? { counted_at: markCountedAt } : {}),
        updatedAt: now,
      },
      { where: { product_id: pid, warehouse_id: wid }, ...opts },
    );
  } else if (delta > 0) {
    const inc = round3(delta);
    if (models.sequelize?.query) {
      await models.sequelize.query(
        `UPDATE \`RETAIL_STOCK_LEVELS\`
         SET qty_on_hand = qty_on_hand + ?, updatedAt = ?
         WHERE product_id = ? AND warehouse_id = ?`,
        { replacements: [inc, now, pid, wid], ...opts },
      );
    } else {
      const level = await models.RetailStockLevel.findOne({
        where: { product_id: pid, warehouse_id: wid },
        ...opts,
      });
      await level.update({ qty_on_hand: round3(Number(level.qty_on_hand) + inc), updatedAt: now }, opts);
    }
  } else if (delta < 0) {
    const dec = round3(-delta);
    let affected = 0;
    if (models.sequelize?.query) {
      const [, meta] = await models.sequelize.query(
        `UPDATE \`RETAIL_STOCK_LEVELS\`
         SET qty_on_hand = qty_on_hand - ?, updatedAt = ?
         WHERE product_id = ? AND warehouse_id = ? AND (? OR qty_on_hand >= ?)`,
        { replacements: [dec, now, pid, wid, allowNegative ? 1 : 0, dec], ...opts },
      );
      affected = meta?.affectedRows ?? meta?.rowCount ?? 0;
    } else {
      const where = {
        product_id: pid,
        warehouse_id: wid,
        ...(!allowNegative ? { qty_on_hand: { [Op.gte]: dec } } : {}),
      };
      const [rowsUpdated] = await models.RetailStockLevel.update(
        { qty_on_hand: models.sequelize?.literal ? models.sequelize.literal(`qty_on_hand - ${dec}`) : 0, updatedAt: now },
        { where, ...opts },
      );
      affected = rowsUpdated;
    }

    if (affected !== 1) {
      const current = await models.RetailStockLevel.findOne({
        where: { product_id: pid, warehouse_id: wid },
        ...opts,
      });
      const available = round3(Number(current?.qty_on_hand || 0));
      const err = new AppError(
        `Insufficient stock for product ${pid} (available ${available}, requested ${dec}).`,
        409,
      );
      err.code = "out_of_stock";
      err.data = { code: "out_of_stock", product_id: pid, warehouse_id: wid, available, requested: dec };
      throw err;
    }
  }

  const updatedLevel = await models.RetailStockLevel.findOne({
    where: { product_id: pid, warehouse_id: wid },
    ...opts,
  });
  const qtyAfter = round3(Number(updatedLevel?.qty_on_hand ?? 0));
  const changeRounded = round3(delta);

  if (changeRounded !== 0 || movementType === "OPENING") {
    await models.RetailStockMovement.create(
      {
        product_id: pid,
        warehouse_id: wid,
        qty_change: changeRounded,
        qty_after: qtyAfter,
        type: movementType,
        reason,
        unit_cost: round4(unit_cost),
        doc_id,
        sale_line_id,
        user_id,
        occurred_at,
        createdAt: now,
      },
      opts,
    );
  }

  return qtyAfter;
};

const prepareReceiveLines = (rawLines, productsById, deliveryCharge, { isPosting }) => {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new AppError("lines must be a non-empty array.", 400);
  }

  const prepared = rawLines.map((raw, idx) => {
    const product = productsById.get(Number(raw?.product_id));
    if (!product) throw new AppError(`Product ${raw?.product_id} not found.`, 404);

    const qty = Number(raw?.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new AppError(`Line ${idx + 1}: qty must be greater than 0.`, 400);
    }

    let unit = null;
    let factor = 1;
    if (raw?.unit_id !== undefined && raw?.unit_id !== null && raw?.unit_id !== "") {
      unit = (product.Units || []).find((u) => Number(u.unit_id) === Number(raw.unit_id));
      if (!unit) {
        throw new AppError(`Line ${idx + 1}: unit_id ${raw.unit_id} does not belong to product ${product.product_id}.`, 400);
      }
      factor = Number(unit.factor);
    }

    const baseQty = round3(qty * factor);
    const enteredUnitCost = Number(raw?.unit_cost ?? raw?.entered_unit_cost);
    if (!Number.isFinite(enteredUnitCost) || enteredUnitCost < 0) {
      throw new AppError(`Line ${idx + 1}: unit_cost must be a non-negative number.`, 400);
    }

    const serials = raw?.serials !== undefined && raw?.serials !== null ? raw.serials : null;
    if (product.tracking === "serial" && product.serial_capture === "receive") {
      if (isPosting || serials !== null) {
        if (!Array.isArray(serials)) {
          throw new AppError(`Line ${idx + 1}: serials array is required for ${product.name}.`, 400);
        }
        const cleaned = serials.map((s) => String(s || "").trim()).filter(Boolean);
        if (cleaned.length !== baseQty || new Set(cleaned).size !== baseQty) {
          throw new AppError(
            `Line ${idx + 1}: ${product.name} requires exactly ${baseQty} unique serial numbers.`,
            400,
          );
        }
      }
    } else if (Array.isArray(serials) && serials.length > 0) {
      throw new AppError(
        `Line ${idx + 1}: ${product.name} does not accept serial numbers on receive.`,
        400,
      );
    }

    const lineValueCents = toCents(qty * enteredUnitCost);
    return {
      product_id: product.product_id,
      unit_id: unit ? unit.unit_id : null,
      qty: round3(qty),
      base_qty: baseQty,
      entered_unit_cost: round4(enteredUnitCost),
      line_value_cents: lineValueCents,
      serials: Array.isArray(serials) ? serials.map((s) => String(s).trim()).filter(Boolean) : null,
    };
  });

  // Check duplicate serials across lines for the same product
  const seenSerialsByProduct = new Map();
  for (const line of prepared) {
    if (!line.serials) continue;
    const set = seenSerialsByProduct.get(line.product_id) || new Set();
    for (const s of line.serials) {
      if (set.has(s)) {
        throw new AppError(`Duplicate serial number "${s}" for product ${line.product_id}.`, 400);
      }
      set.add(s);
    }
    seenSerialsByProduct.set(line.product_id, set);
  }

  const deliveryCents = toCents(deliveryCharge || 0);
  const weights = prepared.map((l) => l.line_value_cents);
  const deliveryShares = splitByWeight(deliveryCents, weights);
  const totalCostCents = addCents(weights, deliveryCents);

  for (let i = 0; i < prepared.length; i++) {
    const lineTotalCents = weights[i] + deliveryShares[i];
    prepared[i].unit_cost = round4(fromCents(lineTotalCents) / prepared[i].base_qty);
  }

  return {
    lines: prepared,
    totalCost: fromCents(totalCostCents),
    deliveryCharge: fromCents(deliveryCents),
  };
};

const postReceiveInTransaction = async (
  models,
  doc,
  lines,
  productsById,
  { userId, now, transaction },
) => {
  const opts = transaction ? { transaction } : {};

  // Check serial uniqueness in DB before mutating stock
  for (const line of lines) {
    const product = productsById.get(Number(line.product_id));
    if (product.tracking === "serial" && product.serial_capture === "receive") {
      const serials = parseJsonField(line.serials);
      if (!Array.isArray(serials) || serials.length !== Number(line.base_qty)) {
        throw new AppError(
          `Product "${product.name}" requires exactly ${line.base_qty} serial numbers before posting.`,
          400,
        );
      }
      const existing = await models.RetailSerial.findAll({
        where: { product_id: product.product_id, serial_no: { [Op.in]: serials } },
        attributes: ["serial_no"],
        raw: true,
        ...opts,
      });
      if (existing.length > 0) {
        throw new AppError(
          `Serial number "${existing[0].serial_no}" already exists for ${product.name}.`,
          409,
        );
      }
    }
  }

  // Lock all (product_id, warehouse_id) pairs in product_id ASC order
  await lockStockLevelsInOrder(
    models,
    lines.map((l) => ({ product_id: l.product_id, warehouse_id: doc.warehouse_id })),
    opts,
  );

  // Sum existing stock across ALL locations per product for weighted average cost
  const uniquePids = [...new Set(lines.map((l) => Number(l.product_id)))];

  // Lock the products and re-read them, so two deliveries of the same item posted at the same time
  // can't both start from the old avg_cost (the second would overwrite the first's result).
  const productLock = transaction && models.sequelize?.constructor?.Transaction?.LOCK?.UPDATE;
  const lockedProducts = await models.RetailProduct.findAll({
    where: { product_id: { [Op.in]: uniquePids } },
    order: [["product_id", "ASC"]],
    ...(productLock ? { lock: productLock } : {}),
    ...opts,
  });
  const lockedById = new Map((lockedProducts || []).map((p) => [Number(p.product_id), p]));

  const allLevels = await models.RetailStockLevel.findAll({
    where: { product_id: { [Op.in]: uniquePids } },
    attributes: ["product_id", "qty_on_hand"],
    raw: true,
    ...opts,
  });
  const totalQtyByProduct = new Map();
  for (const lvl of allLevels || []) {
    const pid = Number(lvl.product_id);
    totalQtyByProduct.set(pid, round3((totalQtyByProduct.get(pid) || 0) + Number(lvl.qty_on_hand || 0)));
  }

  for (const line of lines) {
    // The locked row: its avg_cost is current, and the new average is written back to it.
    const product = lockedById.get(Number(line.product_id)) || productsById.get(Number(line.product_id));
    const baseQty = Number(line.base_qty);
    const receivedCost = Number(line.unit_cost);

    const prevAllLocQty = totalQtyByProduct.get(product.product_id) || 0;
    const effectiveOldQty = Math.max(prevAllLocQty, 0);
    const oldAvg = Number(product.avg_cost || 0);
    const newAvg =
      effectiveOldQty <= 0
        ? round4(receivedCost)
        : round4((effectiveOldQty * oldAvg + baseQty * receivedCost) / (effectiveOldQty + baseQty));

    totalQtyByProduct.set(product.product_id, round3(prevAllLocQty + baseQty));

    await applyStockChange(models, {
      product_id: product.product_id,
      warehouse_id: doc.warehouse_id,
      delta: baseQty,
      movementType: "RECEIVE",
      unit_cost: receivedCost,
      doc_id: doc.doc_id,
      user_id: userId ?? doc.user_id,
      occurred_at: doc.occurred_at,
      now,
      transaction,
    });

    await product.update(
      {
        avg_cost: newAvg,
        last_cost: round4(receivedCost),
        last_received_at: doc.occurred_at,
      },
      opts,
    );

    if (product.tracking === "serial" && product.serial_capture === "receive") {
      const serials = parseJsonField(line.serials);
      for (const serialNo of serials) {
        await models.RetailSerial.create(
          {
            product_id: product.product_id,
            serial_no: serialNo,
            warehouse_id: doc.warehouse_id,
            status: "in_stock",
            receive_doc_id: doc.doc_id,
          },
          opts,
        );
      }
    }
  }
};

export const getStockDocumentById = async (models, docId, { transaction } = {}) => {
  const opts = transaction ? { transaction } : {};
  const doc = await models.RetailStockDocument.findByPk(docId, {
    include: [
      { model: models.Warehouse, as: "Warehouse", attributes: ["warehouse_id", "location_name"], required: false },
      { model: models.User, as: "User", attributes: ["user_id", "first_name", "last_name", "username"], required: false },
      {
        model: models.RetailStockDocumentLine,
        as: "Lines",
        include: [
          {
            model: models.RetailProduct,
            attributes: ["product_id", "code", "name", "base_unit", "tracking", "serial_capture", "avg_cost"],
          },
          {
            model: models.RetailProductUnit,
            as: "Unit",
            attributes: ["unit_id", "unit_name", "factor"],
            required: false,
          },
        ],
      },
    ],
    ...opts,
  });
  if (!doc) throw new AppError("Stock document not found.", 404);
  const serials = await models.RetailSerial.findAll({
    where: { receive_doc_id: doc.doc_id },
    attributes: ["serial_id", "product_id", "serial_no", "status"],
    raw: true,
    ...opts,
  });
  const plain = typeof doc.toJSON === "function" ? doc.toJSON() : doc;
  return { ...plain, serials };
};

export const createReceiveDocument = async (
  models,
  userId,
  body = {},
  { effectivePermissions = null, now = new Date() } = {},
) => {
  const supplierName = String(body.supplier_name || "").trim();
  if (!supplierName) throw new AppError("supplier_name is required.", 400);

  const deliveryCharge = Number(body.delivery_charge ?? 0);
  if (!Number.isFinite(deliveryCharge) || deliveryCharge < 0) {
    throw new AppError("delivery_charge must be a non-negative number.", 400);
  }

  const settings = await getRetailSettings(models);
  const warehouseId = await resolveWarehouseId(models, body.warehouse_id, settings);
  const occurredAt = await validateOccurredAt(models, body.occurred_at, {
    userId,
    effectivePermissions,
    settings,
    now,
  });
  const isPosting = Boolean(body.post);

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    const productIds = (body.lines || []).map((l) => l?.product_id);
    const productsById = await assertTrackableProducts(models, productIds, opts);
    const { lines, totalCost, deliveryCharge: cleanDelivery } = prepareReceiveLines(
      body.lines,
      productsById,
      deliveryCharge,
      { isPosting },
    );

    const doc = await createDocumentWithRetry(
      models,
      {
        doc_type: "receive",
        status: isPosting ? "posted" : "draft",
        warehouse_id: warehouseId,
        supplier_name: supplierName.slice(0, 160),
        supplier_ref: body.supplier_ref ? String(body.supplier_ref).trim().slice(0, 80) : null,
        note: body.note ? String(body.note).trim().slice(0, 500) : null,
        delivery_charge: cleanDelivery,
        total_cost: totalCost,
        user_id: userId ?? null,
        occurred_at: occurredAt,
        posted_at: isPosting ? now : null,
        version: 1,
      },
      opts,
    );

    const createdLines = [];
    for (const l of lines) {
      const created = await models.RetailStockDocumentLine.create(
        {
          doc_id: doc.doc_id,
          product_id: l.product_id,
          unit_id: l.unit_id,
          qty: l.qty,
          base_qty: l.base_qty,
          entered_unit_cost: l.entered_unit_cost,
          unit_cost: isPosting ? l.unit_cost : null,
          serials: l.serials,
        },
        opts,
      );
      createdLines.push({ ...created.get?.({ plain: true }) ?? created, unit_cost: l.unit_cost });
    }

    if (isPosting) {
      await postReceiveInTransaction(models, doc, createdLines, productsById, {
        userId,
        now,
        transaction,
      });
    }

    return getStockDocumentById(models, doc.doc_id, opts);
  });
};

export const updateReceiveDraft = async (
  models,
  docId,
  userId,
  body = {},
  { effectivePermissions = null, now = new Date() } = {},
) => {
  const version = Number(body.version);
  if (!Number.isInteger(version) || version < 1) {
    throw new AppError("version is required for updating a draft.", 400);
  }

  const doc = await models.RetailStockDocument.findByPk(docId);
  if (!doc || doc.doc_type !== "receive") {
    throw new AppError("Receive document not found.", 404);
  }
  if (doc.status !== "draft") {
    throw new AppError("Posted documents cannot be edited.", 409);
  }
  if (Number(doc.version) !== version) {
    throw new AppError("Draft was modified by someone else. Reload and try again.", 409);
  }

  const settings = await getRetailSettings(models);
  const warehouseId = body.warehouse_id
    ? await resolveWarehouseId(models, body.warehouse_id, settings)
    : doc.warehouse_id;
  const occurredAt =
    body.occurred_at !== undefined
      ? await validateOccurredAt(models, body.occurred_at, {
          userId,
          effectivePermissions,
          settings,
          now,
        })
      : doc.occurred_at;

  const supplierName =
    body.supplier_name !== undefined ? String(body.supplier_name || "").trim() : doc.supplier_name;
  if (!supplierName) throw new AppError("supplier_name cannot be empty.", 400);

  const deliveryCharge =
    body.delivery_charge !== undefined ? Number(body.delivery_charge) : Number(doc.delivery_charge);
  if (!Number.isFinite(deliveryCharge) || deliveryCharge < 0) {
    throw new AppError("delivery_charge must be a non-negative number.", 400);
  }

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};

    let lineData = null;
    if (body.lines !== undefined) {
      const productIds = (body.lines || []).map((l) => l?.product_id);
      const productsById = await assertTrackableProducts(models, productIds, opts);
      lineData = prepareReceiveLines(body.lines, productsById, deliveryCharge, { isPosting: false });
    }

    const [affected] = await models.RetailStockDocument.update(
      {
        warehouse_id: warehouseId,
        supplier_name: supplierName.slice(0, 160),
        supplier_ref:
          body.supplier_ref !== undefined
            ? body.supplier_ref
              ? String(body.supplier_ref).trim().slice(0, 80)
              : null
            : doc.supplier_ref,
        note:
          body.note !== undefined
            ? body.note
              ? String(body.note).trim().slice(0, 500)
              : null
            : doc.note,
        delivery_charge: lineData ? lineData.deliveryCharge : deliveryCharge,
        ...(lineData ? { total_cost: lineData.totalCost } : {}),
        occurred_at: occurredAt,
        version: version + 1,
      },
      { where: { doc_id: doc.doc_id, status: "draft", version }, ...opts },
    );

    if (affected !== 1) {
      throw new AppError("Draft was modified by someone else. Reload and try again.", 409);
    }

    if (lineData) {
      await models.RetailStockDocumentLine.destroy({ where: { doc_id: doc.doc_id }, ...opts });
      for (const l of lineData.lines) {
        await models.RetailStockDocumentLine.create(
          {
            doc_id: doc.doc_id,
            product_id: l.product_id,
            unit_id: l.unit_id,
            qty: l.qty,
            base_qty: l.base_qty,
            entered_unit_cost: l.entered_unit_cost,
            unit_cost: null,
            serials: l.serials,
          },
          opts,
        );
      }
    }

    return getStockDocumentById(models, doc.doc_id, opts);
  });
};

export const postReceiveDocument = async (
  models,
  docId,
  userId,
  { version } = {},
  { effectivePermissions = null, now = new Date() } = {},
) => {
  const existing = await models.RetailStockDocument.findByPk(docId);
  if (!existing || existing.doc_type !== "receive") {
    throw new AppError("Receive document not found.", 404);
  }
  if (existing.status === "posted") {
    return getStockDocumentById(models, existing.doc_id);
  }
  if (version !== undefined && Number(version) !== Number(existing.version)) {
    throw new AppError("Draft was modified by someone else. Reload and try again.", 409);
  }

  const settings = await getRetailSettings(models);
  // A draft whose date is just its creation moment had no date chosen: it is dated when posted, so
  // finishing Monday's draft on Wednesday is not back-dating. A date someone picked is kept and checked.
  const dateWasDefaulted =
    Math.abs(new Date(existing.occurred_at).getTime() - new Date(existing.createdAt).getTime()) < 2000;
  const postOccurredAt = dateWasDefaulted ? now : existing.occurred_at;
  await validateOccurredAt(models, postOccurredAt, {
    userId,
    effectivePermissions,
    settings,
    now,
  });

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    const doc = await models.RetailStockDocument.findByPk(docId, opts);
    if (doc.status === "posted") {
      return getStockDocumentById(models, doc.doc_id, opts);
    }

    const [affected] = await models.RetailStockDocument.update(
      { status: "posted", posted_at: now, version: doc.version + 1 },
      { where: { doc_id: doc.doc_id, status: "draft", version: doc.version }, ...opts },
    );
    if (affected !== 1) {
      const reloaded = await models.RetailStockDocument.findByPk(docId, opts);
      if (reloaded?.status === "posted") return getStockDocumentById(models, docId, opts);
      throw new AppError("Draft was modified while posting. Reload and try again.", 409);
    }

    const dbLines = await models.RetailStockDocumentLine.findAll({
      where: { doc_id: doc.doc_id },
      ...opts,
    });
    const productIds = dbLines.map((l) => l.product_id);
    const productsById = await assertTrackableProducts(models, productIds, opts);

    const { lines: prepared, totalCost } = prepareReceiveLines(
      dbLines.map((l) => ({
        product_id: l.product_id,
        unit_id: l.unit_id,
        qty: l.qty,
        unit_cost: l.entered_unit_cost ?? l.unit_cost ?? 0,
        serials: parseJsonField(l.serials),
      })),
      productsById,
      Number(doc.delivery_charge || 0),
      { isPosting: true },
    );

    for (let i = 0; i < dbLines.length; i++) {
      await dbLines[i].update({ unit_cost: prepared[i].unit_cost }, opts);
    }
    await doc.update({ total_cost: totalCost, status: "posted", posted_at: now, occurred_at: postOccurredAt }, opts);

    await postReceiveInTransaction(models, doc, prepared, productsById, {
      userId,
      now,
      transaction,
    });

    return getStockDocumentById(models, doc.doc_id, opts);
  });
};

export const deleteReceiveDraft = async (models, docId) => {
  const doc = await models.RetailStockDocument.findByPk(docId);
  if (!doc || doc.doc_type !== "receive") {
    throw new AppError("Receive document not found.", 404);
  }
  if (doc.status !== "draft") {
    throw new AppError("Posted documents cannot be deleted.", 409);
  }
  await models.RetailStockDocumentLine.destroy({ where: { doc_id: doc.doc_id } });
  await doc.destroy();
  return { deleted: true, doc_id: doc.doc_id };
};

export const postAdjustDocument = async (
  models,
  userId,
  body = {},
  { effectivePermissions = null, now = new Date() } = {},
) => {
  const reason = String(body.reason || "").trim().toLowerCase();
  if (!ADJUST_REASONS.includes(reason)) {
    throw new AppError(`reason must be one of: ${ADJUST_REASONS.join(", ")}.`, 400);
  }
  const note = body.note ? String(body.note).trim().slice(0, 500) : null;
  if (reason === "other" && !note) {
    throw new AppError("note is required when reason is 'other'.", 400);
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new AppError("lines must be a non-empty array.", 400);
  }

  const settings = await getRetailSettings(models);
  const warehouseId = await resolveWarehouseId(models, body.warehouse_id, settings);
  const occurredAt = await validateOccurredAt(models, body.occurred_at, {
    userId,
    effectivePermissions,
    settings,
    now,
  });

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    const productIds = body.lines.map((l) => l?.product_id);
    const productsById = await assertTrackableProducts(models, productIds, opts);

    const prepared = body.lines.map((raw, idx) => {
      const product = productsById.get(Number(raw?.product_id));
      let signedQty = raw?.qty_change !== undefined ? Number(raw.qty_change) : Number(raw?.qty);
      if (raw?.direction === "out" && signedQty > 0) signedQty = -signedQty;
      if (!Number.isFinite(signedQty) || signedQty === 0) {
        throw new AppError(`Line ${idx + 1}: qty / qty_change must be non-zero.`, 400);
      }

      let unit = null;
      let factor = 1;
      if (raw?.unit_id) {
        unit = (product.Units || []).find((u) => Number(u.unit_id) === Number(raw.unit_id));
        if (!unit) throw new AppError(`Line ${idx + 1}: invalid unit_id.`, 400);
        factor = Number(unit.factor);
      }
      const baseQty = round3(signedQty * factor);
      const unitCost =
        raw?.unit_cost !== undefined && raw?.unit_cost !== null && raw?.unit_cost !== ""
          ? Number(raw.unit_cost)
          : Number(product.avg_cost || 0);
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        throw new AppError(`Line ${idx + 1}: unit_cost must be non-negative.`, 400);
      }

      return {
        product_id: product.product_id,
        unit_id: unit ? unit.unit_id : null,
        qty: round3(signedQty),
        base_qty: baseQty,
        unit_cost: round4(unitCost),
      };
    });

    const lockedLevels = await lockStockLevelsInOrder(
      models,
      prepared.map((l) => ({ product_id: l.product_id, warehouse_id: warehouseId })),
      opts,
    );

    const totalCostCents = prepared.reduce(
      (acc, l) => acc + toCents(Math.abs(l.base_qty) * l.unit_cost),
      0,
    );

    const doc = await createDocumentWithRetry(
      models,
      {
        doc_type: "adjust",
        status: "posted",
        warehouse_id: warehouseId,
        reason,
        note,
        total_cost: fromCents(totalCostCents),
        user_id: userId ?? null,
        occurred_at: occurredAt,
        posted_at: now,
        version: 1,
      },
      opts,
    );

    for (const l of prepared) {
      await models.RetailStockDocumentLine.create(
        {
          doc_id: doc.doc_id,
          product_id: l.product_id,
          unit_id: l.unit_id,
          qty: l.qty,
          base_qty: l.base_qty,
          unit_cost: l.unit_cost,
        },
        opts,
      );

      const level = lockedLevels.get(`${l.product_id}:${warehouseId}`);
      const allowNegative = settings.negativeStock !== "block" || level?.counted_at === null;
      await applyStockChange(models, {
        product_id: l.product_id,
        warehouse_id: warehouseId,
        delta: l.base_qty,
        allowNegative,
        movementType: l.base_qty > 0 ? "ADJUST_IN" : "ADJUST_OUT",
        reason,
        unit_cost: l.unit_cost,
        doc_id: doc.doc_id,
        user_id: userId,
        occurred_at: occurredAt,
        now,
        transaction,
      });
    }

    return getStockDocumentById(models, doc.doc_id, opts);
  });
};

export const postCountDocument = async (
  models,
  userId,
  body = {},
  { effectivePermissions = null, now = new Date() } = {},
) => {
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new AppError("lines must be a non-empty array.", 400);
  }

  const settings = await getRetailSettings(models);
  const warehouseId = await resolveWarehouseId(models, body.warehouse_id, settings);
  const occurredAt = await validateOccurredAt(models, body.occurred_at, {
    userId,
    effectivePermissions,
    settings,
    now,
  });

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    const productIds = body.lines.map((l) => l?.product_id);
    const productsById = await assertTrackableProducts(models, productIds, opts);

    const prepared = body.lines.map((raw, idx) => {
      const countedQty = Number(raw?.counted_qty);
      if (!Number.isFinite(countedQty) || countedQty < 0) {
        throw new AppError(`Line ${idx + 1}: counted_qty must be >= 0.`, 400);
      }
      return {
        product_id: Number(raw.product_id),
        counted_qty: round3(countedQty),
      };
    });

    const lockedLevels = await lockStockLevelsInOrder(
      models,
      prepared.map((l) => ({ product_id: l.product_id, warehouse_id: warehouseId })),
      opts,
    );

    const doc = await createDocumentWithRetry(
      models,
      {
        doc_type: "count",
        status: "posted",
        warehouse_id: warehouseId,
        note: body.note ? String(body.note).trim().slice(0, 500) : null,
        total_cost: 0,
        user_id: userId ?? null,
        occurred_at: occurredAt,
        posted_at: now,
        version: 1,
      },
      opts,
    );

    const lineSummaries = [];
    for (const l of prepared) {
      const product = productsById.get(l.product_id);
      const level = lockedLevels.get(`${l.product_id}:${warehouseId}`);
      const systemQty = round3(Number(level?.qty_on_hand || 0));
      const diff = round3(l.counted_qty - systemQty);

      await models.RetailStockDocumentLine.create(
        {
          doc_id: doc.doc_id,
          product_id: l.product_id,
          qty: diff,
          base_qty: diff,
          counted_qty: l.counted_qty,
          system_qty: systemQty,
          unit_cost: Number(product.avg_cost || 0),
        },
        opts,
      );

      await applyStockChange(models, {
        product_id: l.product_id,
        warehouse_id: warehouseId,
        delta: diff,
        setExactQty: l.counted_qty,
        markCountedAt: now,
        movementType: diff >= 0 ? "COUNT_IN" : "COUNT_OUT",
        reason: "count",
        unit_cost: Number(product.avg_cost || 0),
        doc_id: doc.doc_id,
        user_id: userId,
        occurred_at: occurredAt,
        now,
        transaction,
      });

      lineSummaries.push({
        product_id: l.product_id,
        system_qty: systemQty,
        counted_qty: l.counted_qty,
        difference: diff,
      });
    }

    const full = await getStockDocumentById(models, doc.doc_id, opts);
    return { ...full, line_summaries: lineSummaries };
  });
};

export const postOpeningDocument = async (
  models,
  userId,
  body = {},
  { effectivePermissions = null, now = new Date() } = {},
) => {
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new AppError("lines must be a non-empty array.", 400);
  }

  const settings = await getRetailSettings(models);
  const warehouseId = await resolveWarehouseId(models, body.warehouse_id, settings);
  const occurredAt = await validateOccurredAt(models, body.occurred_at, {
    userId,
    effectivePermissions,
    settings,
    now,
  });

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    const productIds = body.lines.map((l) => l?.product_id);
    const productsById = await assertTrackableProducts(models, productIds, opts);

    const prepared = body.lines.map((raw, idx) => {
      const qty = Number(raw?.qty ?? raw?.counted_qty);
      if (!Number.isFinite(qty) || qty < 0) {
        throw new AppError(`Line ${idx + 1}: qty must be >= 0.`, 400);
      }
      const unitCost =
        raw?.unit_cost !== undefined && raw?.unit_cost !== null && raw?.unit_cost !== ""
          ? Number(raw.unit_cost)
          : null;
      if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
        throw new AppError(`Line ${idx + 1}: unit_cost must be non-negative.`, 400);
      }
      return { product_id: Number(raw.product_id), qty: round3(qty), unit_cost: unitCost };
    });

    const lockedLevels = await lockStockLevelsInOrder(
      models,
      prepared.map((l) => ({ product_id: l.product_id, warehouse_id: warehouseId })),
      opts,
    );

    const doc = await createDocumentWithRetry(
      models,
      {
        doc_type: "opening",
        status: "posted",
        warehouse_id: warehouseId,
        note: body.note ? String(body.note).trim().slice(0, 500) : null,
        total_cost: 0,
        user_id: userId ?? null,
        occurred_at: occurredAt,
        posted_at: now,
        version: 1,
      },
      opts,
    );

    for (const l of prepared) {
      const product = productsById.get(l.product_id);
      const level = lockedLevels.get(`${l.product_id}:${warehouseId}`);
      const systemQty = round3(Number(level?.qty_on_hand || 0));
      const diff = round3(l.qty - systemQty);

      let effectiveCost = Number(product.avg_cost || 0);
      if (l.unit_cost !== null && effectiveCost === 0) {
        effectiveCost = round4(l.unit_cost);
        await product.update({ avg_cost: effectiveCost, last_cost: effectiveCost }, opts);
      }

      await models.RetailStockDocumentLine.create(
        {
          doc_id: doc.doc_id,
          product_id: l.product_id,
          qty: l.qty,
          base_qty: diff,
          counted_qty: l.qty,
          system_qty: systemQty,
          unit_cost: effectiveCost,
        },
        opts,
      );

      await applyStockChange(models, {
        product_id: l.product_id,
        warehouse_id: warehouseId,
        delta: diff,
        setExactQty: l.qty,
        markCountedAt: now,
        movementType: "OPENING",
        reason: "opening",
        unit_cost: effectiveCost,
        doc_id: doc.doc_id,
        user_id: userId,
        occurred_at: occurredAt,
        now,
        transaction,
      });
    }

    return getStockDocumentById(models, doc.doc_id, opts);
  });
};

// ── Reads & Integrity ────────────────────────────────────────────────────────

export const listStockDocuments = async (
  models,
  { type, status, from, to, supplier, page = 1, limit = 20 } = {},
) => {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const offset = (safePage - 1) * safeLimit;

  const where = {};
  if (type) where.doc_type = type;
  if (status) where.status = status;
  if (supplier && String(supplier).trim()) {
    where.supplier_name = { [Op.like]: `%${escapeLike(String(supplier).trim())}%` };
  }
  if (from || to) {
    where.occurred_at = {};
    if (from) where.occurred_at[Op.gte] = new Date(from);
    if (to) where.occurred_at[Op.lte] = new Date(to);
  }

  const { count, rows } = await models.RetailStockDocument.findAndCountAll({
    where,
    include: [
      { model: models.Warehouse, as: "Warehouse", attributes: ["warehouse_id", "location_name"], required: false },
      { model: models.User, as: "User", attributes: ["user_id", "first_name", "last_name", "username"], required: false },
    ],
    distinct: true,
    col: "doc_id",
    order: [["occurred_at", "DESC"], ["doc_id", "DESC"]],
    limit: safeLimit,
    offset,
  });

  return { documents: rows, total: count, page: safePage, limit: safeLimit };
};

export const listSuppliers = async (models, { q = "" } = {}) => {
  const where = { doc_type: "receive", supplier_name: { [Op.ne]: null } };
  if (q && String(q).trim()) {
    where.supplier_name = { [Op.like]: `%${escapeLike(String(q).trim())}%` };
  }
  const rows = await models.RetailStockDocument.findAll({
    where,
    attributes: ["supplier_name", "occurred_at"],
    order: [["occurred_at", "DESC"], ["doc_id", "DESC"]],
    limit: 200,
    raw: true,
  });
  const seen = new Set();
  const suppliers = [];
  for (const r of rows) {
    const name = String(r.supplier_name || "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    suppliers.push(name);
    if (suppliers.length >= 30) break;
  }
  return suppliers;
};

export const getSupplierItems = async (models, { supplier } = {}) => {
  const name = String(supplier || "").trim();
  if (!name) throw new AppError("supplier query parameter is required.", 400);

  const docs = await models.RetailStockDocument.findAll({
    where: { doc_type: "receive", status: "posted", supplier_name: name },
    attributes: ["doc_id", "occurred_at"],
    order: [["occurred_at", "DESC"], ["doc_id", "DESC"]],
    raw: true,
  });
  if (docs.length === 0) return [];

  const docDateById = new Map(docs.map((d) => [d.doc_id, d.occurred_at]));
  const lines = await models.RetailStockDocumentLine.findAll({
    where: { doc_id: { [Op.in]: docs.map((d) => d.doc_id) } },
    include: [
      { model: models.RetailProduct, attributes: ["product_id", "code", "name", "base_unit", "sell_price"] },
      { model: models.RetailProductUnit, as: "Unit", attributes: ["unit_id", "unit_name", "factor"], required: false },
    ],
    order: [["doc_id", "DESC"], ["line_id", "DESC"]],
  });

  const byProduct = new Map();
  for (const l of lines) {
    const pid = l.product_id;
    const occurred = docDateById.get(l.doc_id);
    if (!byProduct.has(pid)) {
      byProduct.set(pid, {
        product_id: pid,
        product: l.RetailProduct,
        times_received: 1,
        last_received_at: occurred,
        last_unit_cost: l.entered_unit_cost ?? l.unit_cost,
        last_unit_id: l.unit_id,
        last_unit: l.Unit || null,
      });
    } else {
      byProduct.get(pid).times_received += 1;
    }
  }

  return [...byProduct.values()].sort(
    (a, b) =>
      b.times_received - a.times_received ||
      new Date(b.last_received_at).getTime() - new Date(a.last_received_at).getTime(),
  );
};

export const getStockLevelsDelta = async (models, { since, warehouse_id } = {}) => {
  const serverTime = new Date(Date.now() - 5000).toISOString();
  const where = {};
  if (warehouse_id) where.warehouse_id = Number(warehouse_id);
  if (since) {
    const d = new Date(since);
    if (Number.isNaN(d.getTime())) throw new AppError("Invalid since timestamp.", 400);
    where.updatedAt = { [Op.gt]: d };
  }

  const levels = await models.RetailStockLevel.findAll({
    where,
    attributes: [
      "product_id",
      "warehouse_id",
      "qty_on_hand",
      "counted_at",
      "reorder_level",
      "reorder_qty",
      "updatedAt",
    ],
    order: [["product_id", "ASC"], ["warehouse_id", "ASC"]],
    raw: true,
  });

  return { server_time: serverTime, levels };
};

export const updateStockLevelThresholds = async (
  models,
  productId,
  warehouseId,
  { reorder_level, reorder_qty } = {},
) => {
  const pid = Number(productId);
  const wid = Number(warehouseId);
  const product = await models.RetailProduct.findByPk(pid);
  if (!product) throw new AppError("Product not found.", 404);
  const warehouse = await models.Warehouse.findByPk(wid);
  if (!warehouse) throw new AppError("Warehouse not found.", 404);

  const rLevel = reorder_level === null || reorder_level === "" || reorder_level === undefined
    ? null
    : Number(reorder_level);
  const rQty = reorder_qty === null || reorder_qty === "" || reorder_qty === undefined
    ? null
    : Number(reorder_qty);
  if (rLevel !== null && (!Number.isFinite(rLevel) || rLevel < 0)) {
    throw new AppError("reorder_level must be >= 0 or null.", 400);
  }
  if (rQty !== null && (!Number.isFinite(rQty) || rQty < 0)) {
    throw new AppError("reorder_qty must be >= 0 or null.", 400);
  }

  let level = await models.RetailStockLevel.findOne({ where: { product_id: pid, warehouse_id: wid } });
  if (!level) {
    level = await models.RetailStockLevel.create({
      product_id: pid,
      warehouse_id: wid,
      qty_on_hand: 0,
      reorder_level: rLevel,
      reorder_qty: rQty,
      counted_at: null,
    });
  } else {
    await level.update({ reorder_level: rLevel, reorder_qty: rQty });
  }
  return level;
};

export const listStockMovements = async (
  models,
  { product_id, warehouse_id, type, user_id, from, to, page = 1, limit = 30 } = {},
) => {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
  const offset = (safePage - 1) * safeLimit;

  const where = {};
  if (product_id) where.product_id = Number(product_id);
  if (warehouse_id) where.warehouse_id = Number(warehouse_id);
  if (type) where.type = type;
  if (user_id) where.user_id = Number(user_id);
  if (from || to) {
    where.occurred_at = {};
    if (from) where.occurred_at[Op.gte] = new Date(from);
    if (to) where.occurred_at[Op.lte] = new Date(to);
  }

  const { count, rows } = await models.RetailStockMovement.findAndCountAll({
    where,
    include: [
      { model: models.RetailProduct, attributes: ["product_id", "code", "name", "base_unit"], required: false },
      { model: models.Warehouse, attributes: ["warehouse_id", "location_name"], required: false },
      { model: models.RetailStockDocument, as: "Document", attributes: ["doc_id", "doc_no", "doc_type"], required: false },
      { model: models.User, as: "User", attributes: ["user_id", "first_name", "last_name", "username"], required: false },
    ],
    distinct: true,
    col: "movement_id",
    order: [["occurred_at", "DESC"], ["movement_id", "DESC"]],
    limit: safeLimit,
    offset,
  });

  const movements = rows.map((r) => {
    const plain = typeof r.toJSON === "function" ? r.toJSON() : r;
    return {
      ...plain,
      doc_no: plain.Document?.doc_no || null,
      user_name: plain.User
        ? [plain.User.first_name, plain.User.last_name].filter(Boolean).join(" ").trim() || plain.User.username
        : null,
      invoice_id: null,
    };
  });

  return { movements, total: count, page: safePage, limit: safeLimit };
};

export const getStockSummary = async (models, { warehouse_id } = {}) => {
  const [products, levels] = await Promise.all([
    models.RetailProduct.findAll({
      where: { is_active: true, tracking: { [Op.in]: ["counted", "serial"] } },
      attributes: ["product_id", "reorder_level", "avg_cost"],
      raw: true,
    }),
    models.RetailStockLevel.findAll({
      where: warehouse_id ? { warehouse_id: Number(warehouse_id) } : {},
      attributes: ["product_id", "warehouse_id", "qty_on_hand", "counted_at", "reorder_level"],
      raw: true,
    }),
  ]);

  const levelByProduct = new Map();
  for (const lvl of levels) {
    const pid = Number(lvl.product_id);
    const existing = levelByProduct.get(pid);
    if (!existing) {
      levelByProduct.set(pid, {
        qty: Number(lvl.qty_on_hand || 0),
        counted: lvl.counted_at !== null,
        reorder_level: lvl.reorder_level !== null && lvl.reorder_level !== undefined
          ? Number(lvl.reorder_level)
          : null,
      });
    } else {
      existing.qty += Number(lvl.qty_on_hand || 0);
      existing.counted = existing.counted || lvl.counted_at !== null;
      if (existing.reorder_level === null && lvl.reorder_level !== null) {
        existing.reorder_level = Number(lvl.reorder_level);
      }
    }
  }

  let itemsCounted = 0;
  let itemsNotCounted = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let valueCents = 0;

  for (const p of products) {
    const info = levelByProduct.get(Number(p.product_id));
    const qty = info ? info.qty : 0;
    const isCounted = info ? info.counted : false;
    const threshold =
      info && info.reorder_level !== null
        ? info.reorder_level
        : p.reorder_level !== null && p.reorder_level !== undefined
          ? Number(p.reorder_level)
          : null;

    if (isCounted) itemsCounted += 1;
    else itemsNotCounted += 1;

    if (isCounted && qty <= 0) outOfStockCount += 1;
    if (isCounted && threshold !== null && qty <= threshold) lowStockCount += 1;

    if (qty > 0) {
      valueCents += toCents(qty * Number(p.avg_cost || 0));
    }
  }

  return {
    items_counted: itemsCounted,
    items_not_counted: itemsNotCounted,
    low_stock_count: lowStockCount,
    out_of_stock_count: outOfStockCount,
    stock_value: fromCents(valueCents),
  };
};

export const getProductStockAndMovements = async (models, productId) => {
  if (!models?.RetailStockLevel?.findAll || !models?.RetailStockMovement?.findAll) {
    return { stock: null, recent_movements: [] };
  }
  const [levels, movements] = await Promise.all([
    models.RetailStockLevel.findAll({
      where: { product_id: Number(productId) },
      include: [{ model: models.Warehouse, attributes: ["warehouse_id", "location_name"], required: false }],
      order: [["warehouse_id", "ASC"]],
    }),
    models.RetailStockMovement.findAll({
      where: { product_id: Number(productId) },
      include: [
        { model: models.Warehouse, attributes: ["warehouse_id", "location_name"], required: false },
        { model: models.RetailStockDocument, as: "Document", attributes: ["doc_id", "doc_no", "doc_type"], required: false },
        { model: models.User, as: "User", attributes: ["user_id", "first_name", "last_name", "username"], required: false },
      ],
      order: [["occurred_at", "DESC"], ["movement_id", "DESC"]],
      limit: 20,
    }),
  ]);

  const stock = levels.map((l) => {
    const plain = typeof l.toJSON === "function" ? l.toJSON() : l;
    return {
      warehouse_id: plain.warehouse_id,
      location_name: plain.Warehouse?.location_name || `Location #${plain.warehouse_id}`,
      qty_on_hand: plain.qty_on_hand,
      counted_at: plain.counted_at,
      reorder_level: plain.reorder_level,
      reorder_qty: plain.reorder_qty,
    };
  });

  const recentMovements = movements.map((m) => {
    const plain = typeof m.toJSON === "function" ? m.toJSON() : m;
    return {
      ...plain,
      doc_no: plain.Document?.doc_no || null,
      location_name: plain.Warehouse?.location_name || null,
      user_name: plain.User
        ? [plain.User.first_name, plain.User.last_name].filter(Boolean).join(" ").trim() || plain.User.username
        : null,
    };
  });

  return { stock, recent_movements: recentMovements };
};

export const listSerials = async (models, { product_id, status, q } = {}) => {
  const where = {};
  if (product_id) where.product_id = Number(product_id);
  if (status) where.status = status;
  if (q && String(q).trim()) {
    where.serial_no = { [Op.like]: `%${escapeLike(String(q).trim())}%` };
  }

  return models.RetailSerial.findAll({
    where,
    include: [
      { model: models.RetailProduct, attributes: ["product_id", "code", "name"], required: false },
      { model: models.Warehouse, attributes: ["warehouse_id", "location_name"], required: false },
    ],
    order: [["serial_id", "DESC"]],
    limit: 200,
  });
};

/**
 * Compare SUM(qty_change) of RETAIL_STOCK_MOVEMENTS against RETAIL_STOCK_LEVELS.qty_on_hand
 * per (product_id, warehouse_id). Returns mismatches (empty when healthy).
 */
export const checkStockIntegrity = async (models) => {
  const [levels, movements] = await Promise.all([
    models.RetailStockLevel.findAll({
      attributes: ["product_id", "warehouse_id", "qty_on_hand"],
      raw: true,
    }),
    models.RetailStockMovement.findAll({
      attributes: ["product_id", "warehouse_id", "qty_change"],
      raw: true,
    }),
  ]);

  const movementSumByPair = new Map();
  for (const m of movements || []) {
    const key = `${Number(m.product_id)}:${Number(m.warehouse_id)}`;
    movementSumByPair.set(key, round3((movementSumByPair.get(key) || 0) + Number(m.qty_change || 0)));
  }

  const levelByPair = new Map();
  for (const l of levels || []) {
    const key = `${Number(l.product_id)}:${Number(l.warehouse_id)}`;
    levelByPair.set(key, round3(Number(l.qty_on_hand || 0)));
  }

  const allKeys = new Set([...movementSumByPair.keys(), ...levelByPair.keys()]);
  const mismatches = [];
  for (const key of allKeys) {
    const [product_id, warehouse_id] = key.split(":").map(Number);
    const movementsSum = movementSumByPair.get(key) || 0;
    const levelQty = levelByPair.get(key) || 0;
    if (Math.abs(movementsSum - levelQty) > 0.0005) {
      mismatches.push({
        product_id,
        warehouse_id,
        movements_sum: movementsSum,
        qty_on_hand: levelQty,
        difference: round3(levelQty - movementsSum),
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    checked_pairs: allKeys.size,
    mismatches,
    checked_at: new Date().toISOString(),
  };
};

const addMonthsToDateOnly = (date, months) => {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + Number(months || 0));
  return dayInShopTz(d);
};

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

/**
 * Deduct stock for retail sale lines inside an active DB transaction.
 * Enforces negative-stock policy ("block" vs "warn", uncounted items never blocked),
 * updates serialized items + warranty_end, writes SALE movements, and updates last_sold_at.
 */
export const sell = async (
  models,
  {
    lines = [],
    warehouseId = null,
    invoiceId,
    userId,
    occurredAt = new Date(),
    approvals = {},
    transaction,
    now = new Date(),
  },
) => {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { sold: [], warehouse_id: null };
  }

  const opts = transaction ? { transaction } : {};
  const settings = await getRetailSettings(models);
  const wid = await resolveWarehouseId(models, warehouseId, settings, opts);
  const negativeBehavior = settings?.negativeStock || "warn";

  const productIds = [...new Set(lines.map((l) => Number(l.product_id)).filter(Boolean))];
  if (productIds.length === 0) {
    return { sold: [], warehouse_id: wid };
  }

  const products = await models.RetailProduct.findAll({
    where: { product_id: { [Op.in]: productIds } },
    ...opts,
  });
  const productsById = new Map(products.map((p) => [Number(p.product_id), p]));

  const trackedPairs = [];
  for (const line of lines) {
    const product = productsById.get(Number(line.product_id));
    if (!product) {
      throw new AppError(`Product ${line.product_id} not found.`, 404);
    }
    if (product.tracking === "counted" || product.tracking === "serial") {
      trackedPairs.push({ product_id: Number(product.product_id), warehouse_id: wid });
    }
  }

  const lockedLevels = await lockStockLevelsInOrder(models, trackedPairs, { transaction, now });
  const consumedNegTokens = new Map();
  const sold = [];

  for (const line of lines) {
    const pid = Number(line.product_id);
    const product = productsById.get(pid);
    const baseQty = round3(Number(line.base_qty || 0));
    if (baseQty <= 0) {
      throw new AppError(`Invalid sale quantity for product ${pid}.`, 400);
    }

    if (product.tracking === "untracked" || product.tracking === "service") {
      sold.push({ sale_line_id: line.sale_line_id, product_id: pid, qty_after: null });
      continue;
    }

    const level = lockedLevels.get(`${pid}:${wid}`);
    const available = round3(Number(level?.qty_on_hand || 0));
    const isUncounted = level?.counted_at === null || level?.counted_at === undefined;
    const wouldGoNegative = available < baseQty;

    let allowNegative = true;
    if (wouldGoNegative && !isUncounted) {
      if (negativeBehavior === "block") {
        const entry = resolveApprovalEntry(approvals, "negative_stock", pid);
        if (!entry?.token) {
          const err = new AppError(
            `Insufficient stock for ${product.name} (available ${available}, requested ${baseQty}).`,
            409,
          );
          err.code = "out_of_stock";
          err.data = {
            code: "out_of_stock",
            product_id: pid,
            warehouse_id: wid,
            available,
            requested: baseQty,
          };
          throw err;
        }

        let consumed = consumedNegTokens.get(entry.token);
        if (!consumed) {
          // The manager approved selling this item without stock (the counter's context names the product).
          consumed = await consumeApprovalToken(models, entry.token, {
            type: "negative_stock",
            verify: (ctx) => Number(ctx.product_id) === Number(pid),
            userId,
            transaction,
            now,
          });
          consumedNegTokens.set(entry.token, consumed);
        }

        await models.CounterException.create(
          {
            type: "negative_stock",
            status: "approved",
            invoice_id: invoiceId,
            sale_line_id: line.sale_line_id ?? null,
            product_id: pid,
            requested_by: userId,
            approved_by: consumed.approver_user_id,
            approved_at: now,
            new_value: { product_id: pid, warehouse_id: wid, available, requested: baseQty },
            amount_impact: 0,
            summary: `Approved negative stock sale for ${product.name} (${available} -> ${round3(available - baseQty)})`,
            created_at: now,
          },
          opts,
        );
        allowNegative = true;
      } else {
        // negativeBehavior === "warn"
        allowNegative = true;
        await recordCounterException(
          models,
          userId,
          {
            type: "negative_stock",
            invoice_id: invoiceId,
            sale_line_id: line.sale_line_id ?? null,
            product_id: pid,
            context: { product_id: pid, warehouse_id: wid, available, requested: baseQty },
            summary: `Negative stock warning on sale of ${product.name} (${available} -> ${round3(available - baseQty)})`,
          },
          { now, transaction },
        );
      }
    }

    if (product.tracking === "serial") {
      const serialNo = String(line.serial_number ?? line.serial_no ?? "").trim();
      if (!serialNo) {
        throw new AppError(`Serial number is required for ${product.name}.`, 400);
      }
      if (baseQty !== 1) {
        throw new AppError(`Serialized item ${product.name} must be sold with base quantity 1 per line.`, 400);
      }

      const warrantyEnd =
        Number(product.warranty_months) > 0
          ? addMonthsToDateOnly(occurredAt, product.warranty_months)
          : null;

      const existingSerial = await models.RetailSerial.findOne({
        where: { product_id: pid, serial_no: serialNo },
        ...opts,
      });

      if (existingSerial) {
        if (existingSerial.status !== "in_stock" || Number(existingSerial.warehouse_id) !== Number(wid)) {
          const err = new AppError(`Serial ${serialNo} for ${product.name} is not available in stock.`, 409);
          err.code = "out_of_stock";
          err.data = { code: "out_of_stock", product_id: pid, serial_no: serialNo, warehouse_id: wid };
          throw err;
        }
        await existingSerial.update(
          {
            status: "sold",
            sale_line_id: line.sale_line_id ?? null,
            sold_at: occurredAt,
            warranty_end: warrantyEnd,
          },
          opts,
        );
      } else if (product.serial_capture === "sale") {
        await models.RetailSerial.create(
          {
            product_id: pid,
            serial_no: serialNo,
            warehouse_id: wid,
            status: "sold",
            sale_line_id: line.sale_line_id ?? null,
            sold_at: occurredAt,
            warranty_end: warrantyEnd,
          },
          opts,
        );
      } else {
        const err = new AppError(`Serial ${serialNo} for ${product.name} was not found in stock.`, 409);
        err.code = "out_of_stock";
        err.data = { code: "out_of_stock", product_id: pid, serial_no: serialNo, warehouse_id: wid };
        throw err;
      }
    }

    const qtyAfter = await applyStockChange(models, {
      product_id: pid,
      warehouse_id: wid,
      delta: -baseQty,
      allowNegative,
      movementType: "SALE",
      unit_cost: line.unit_cost ?? product.avg_cost ?? 0,
      sale_line_id: line.sale_line_id ?? null,
      user_id: userId,
      occurred_at: occurredAt,
      now,
      transaction,
    });

    sold.push({ sale_line_id: line.sale_line_id, product_id: pid, qty_after: qtyAfter });
  }

  await models.RetailProduct.update(
    { last_sold_at: occurredAt },
    { where: { product_id: { [Op.in]: productIds } }, ...opts },
  );

  return { sold, warehouse_id: wid };
};
