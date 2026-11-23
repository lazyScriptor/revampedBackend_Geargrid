import { Op } from "sequelize";
import AppError from "../../../utils/AppError.js";
import { parseJsonField } from "../../../utils/jsonFields.js";
import {
  ALLOWED_BASE_UNITS,
  DECIMAL_BASE_UNITS,
  getRetailSettings,
} from "../retailSettingsService.js";
import {
  RETAIL_CREATED_VIA,
  RETAIL_SERIAL_CAPTURES,
  RETAIL_TRACKING_TYPES,
} from "../../../models/RetailProduct.js";
import {
  buildSearchText,
  escapeLike,
  generateName,
  generateSinhalaName,
  nextProductCode,
  parseSearchQueryWords,
  withProductCodeRetry,
} from "./naming.js";
import { ensureStarterCatalog } from "./starterService.js";

const COST_KEYS = new Set([
  "avg_cost",
  "last_cost",
  "unit_cost",
  "cost_total",
  "cost",
  "margin",
  "margin_pct",
]);

const CHUNK_SIZE = 500;
const ADMIN_ROLE_NAMES = new Set(["admin", "owner", "superadmin", "super_admin"]);

export const stripCostFields = (value, canViewCost) => {
  if (canViewCost || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripCostFields(item, false));
  }
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const plain = typeof value.toJSON === "function" ? value.toJSON() : value;
    const out = {};
    for (const [k, v] of Object.entries(plain)) {
      if (COST_KEYS.has(k)) continue;
      out[k] = v && typeof v === "object" ? stripCostFields(v, false) : v;
    }
    return out;
  }
  return value;
};

export const userCanViewRetailCost = async (models, userId, effectivePermissions = null) => {
  if (effectivePermissions?.has("*")) return true;
  if (effectivePermissions?.has("retail:cost_view")) return true;
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

  return effective.has("retail:cost_view");
};

const runInTransaction = async (models, fn) => {
  if (models?.sequelize?.transaction) {
    return models.sequelize.transaction(fn);
  }
  return fn(undefined);
};

const validateNonNegNumber = (val, label, { required = false } = {}) => {
  if (val === undefined || val === null || val === "") {
    if (required) throw new AppError(`${label} is required.`, 400);
    return null;
  }
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) {
    throw new AppError(`${label} must be a non-negative number.`, 400);
  }
  return n;
};

const validateProductInput = async (models, body, { isUpdate = false, existing = null } = {}) => {
  const tracking = body.tracking ?? existing?.tracking ?? "counted";
  if (!RETAIL_TRACKING_TYPES.includes(tracking)) {
    throw new AppError(`tracking must be one of: ${RETAIL_TRACKING_TYPES.join(", ")}.`, 400);
  }

  let serialCapture = body.serial_capture !== undefined ? body.serial_capture : (existing?.serial_capture ?? null);
  if (tracking === "serial") {
    if (!RETAIL_SERIAL_CAPTURES.includes(serialCapture)) {
      throw new AppError("serial_capture must be 'receive' or 'sale' when tracking is 'serial'.", 400);
    }
  } else if (body.serial_capture !== undefined && body.serial_capture !== null) {
    throw new AppError("serial_capture is only allowed when tracking is 'serial'.", 400);
  } else {
    serialCapture = null;
  }

  const baseUnit = body.base_unit ?? existing?.base_unit ?? "pcs";
  if (!ALLOWED_BASE_UNITS.includes(baseUnit)) {
    throw new AppError(`base_unit must be one of: ${ALLOWED_BASE_UNITS.join(", ")}.`, 400);
  }

  const allowDecimal =
    body.allow_decimal !== undefined
      ? Boolean(body.allow_decimal)
      : existing
        ? Boolean(existing.allow_decimal)
        : DECIMAL_BASE_UNITS.has(baseUnit);

  if (allowDecimal && !DECIMAL_BASE_UNITS.has(baseUnit)) {
    throw new AppError(
      `allow_decimal is only permitted for: ${[...DECIMAL_BASE_UNITS].join(", ")}.`,
      400,
    );
  }

  const categoryId = Number(body.category_id ?? existing?.category_id);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throw new AppError("category_id is required.", 400);
  }
  const category = await models.RetailCategory.findByPk(categoryId);
  if (!category) {
    throw new AppError("Category not found.", 404);
  }

  const brandId =
    body.brand_id === null || body.brand_id === ""
      ? null
      : body.brand_id !== undefined
        ? Number(body.brand_id)
        : existing?.brand_id ?? null;
  let brand = null;
  if (brandId !== null) {
    brand = await models.RetailBrand.findByPk(brandId);
    if (!brand) throw new AppError("Brand not found.", 404);
  }

  const sellPrice =
    body.sell_price !== undefined
      ? validateNonNegNumber(body.sell_price, "sell_price", { required: true })
      : isUpdate
        ? Number(existing.sell_price)
        : validateNonNegNumber(body.sell_price, "sell_price", { required: true });

  const contractorPrice =
    body.contractor_price !== undefined
      ? validateNonNegNumber(body.contractor_price, "contractor_price")
      : existing?.contractor_price ?? null;
  const tradePrice =
    body.trade_price !== undefined
      ? validateNonNegNumber(body.trade_price, "trade_price")
      : existing?.trade_price ?? null;
  const avgCost =
    body.avg_cost !== undefined
      ? validateNonNegNumber(body.avg_cost, "avg_cost") ?? 0
      : existing?.avg_cost ?? 0;
  const lastCost =
    body.last_cost !== undefined
      ? validateNonNegNumber(body.last_cost, "last_cost")
      : existing?.last_cost ?? null;
  const reorderLevel =
    body.reorder_level !== undefined
      ? validateNonNegNumber(body.reorder_level, "reorder_level")
      : existing?.reorder_level ?? null;

  let warrantyMonths = existing?.warranty_months ?? null;
  if (body.warranty_months !== undefined) {
    if (body.warranty_months === null || body.warranty_months === "") {
      warrantyMonths = null;
    } else {
      const wm = Number(body.warranty_months);
      if (!Number.isInteger(wm) || wm < 0) {
        throw new AppError("warranty_months must be a non-negative integer.", 400);
      }
      warrantyMonths = wm;
    }
  }

  let units = undefined;
  if (body.units !== undefined) {
    if (!Array.isArray(body.units)) {
      throw new AppError("units must be an array.", 400);
    }
    const seenNames = new Set();
    units = body.units.map((u) => {
      const unitName = String(u?.unit_name || "").trim();
      if (!unitName || unitName.length > 20) {
        throw new AppError("Each unit must have a valid unit_name (max 20 chars).", 400);
      }
      if (seenNames.has(unitName.toLowerCase())) {
        throw new AppError(`Duplicate unit_name: ${unitName}`, 400);
      }
      seenNames.add(unitName.toLowerCase());
      const factor = Number(u?.factor);
      if (!Number.isFinite(factor) || factor <= 0) {
        throw new AppError(`Unit ${unitName} factor must be greater than 0.`, 400);
      }
      const uPrice =
        u?.sell_price !== undefined && u?.sell_price !== null && u?.sell_price !== ""
          ? validateNonNegNumber(u.sell_price, `unit ${unitName} sell_price`)
          : null;
      return {
        unit_name: unitName,
        factor,
        sell_price: uPrice,
        is_default_sale: Boolean(u?.is_default_sale),
      };
    });
  }

  const createdVia = body.created_via ?? existing?.created_via ?? "catalog";
  if (!RETAIL_CREATED_VIA.includes(createdVia)) {
    throw new AppError("Invalid created_via value.", 400);
  }

  return {
    tracking,
    serial_capture: serialCapture,
    base_unit: baseUnit,
    allow_decimal: allowDecimal,
    category_id: categoryId,
    category,
    brand_id: brandId,
    brand,
    sell_price: sellPrice,
    contractor_price: contractorPrice,
    trade_price: tradePrice,
    avg_cost: avgCost,
    last_cost: lastCost,
    reorder_level: reorderLevel,
    warranty_months: warrantyMonths,
    units,
    created_via: createdVia,
  };
};

/**
 * Rebuild `search_text` for a list of product IDs in chunks of 500 inside the active transaction.
 */
export const rebuildSearchTextForProducts = async (models, productIds, { transaction } = {}) => {
  const uniqueIds = [...new Set((productIds || []).map(Number).filter((id) => id > 0))];
  if (uniqueIds.length === 0) return 0;

  const opts = transaction ? { transaction } : {};
  const aliases = await models.RetailSearchAlias.findAll({ raw: true, ...opts });

  let updated = 0;
  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    const chunkIds = uniqueIds.slice(i, i + CHUNK_SIZE);
    const products = await models.RetailProduct.findAll({
      where: { product_id: { [Op.in]: chunkIds } },
      include: [
        { model: models.RetailCategory, include: [{ model: models.RetailCategory, as: "Parent" }] },
        { model: models.RetailBrand },
        { model: models.RetailFamily },
        { model: models.RetailProductUnit, as: "Units" },
        { model: models.RetailBarcode, as: "Barcodes" },
      ],
      ...opts,
    });

    for (const p of products) {
      const cat = p.RetailCategory || null;
      const parentCat = cat?.Parent || null;
      const searchText = buildSearchText(p, {
        category: parentCat || cat,
        subCategory: parentCat ? cat : null,
        family: p.RetailFamily || null,
        brand: p.RetailBrand || null,
        units: p.Units || [],
        barcodes: p.Barcodes || [],
        aliases,
      });
      await p.update({ search_text: searchText }, opts);
      updated += 1;
    }
  }
  return updated;
};

const loadFullProduct = async (models, productId, { transaction } = {}) => {
  const opts = transaction ? { transaction } : {};
  return models.RetailProduct.findByPk(productId, {
    include: [
      { model: models.RetailCategory, include: [{ model: models.RetailCategory, as: "Parent" }] },
      { model: models.RetailBrand },
      { model: models.RetailFamily },
      { model: models.RetailProductUnit, as: "Units" },
      { model: models.RetailBarcode, as: "Barcodes", include: [{ model: models.RetailProductUnit, as: "Unit" }] },
    ],
    ...opts,
  });
};

const syncProductUnitsAndBarcodes = async (
  models,
  productId,
  { units, barcodes },
  { transaction } = {},
) => {
  const opts = transaction ? { transaction } : {};
  const createdUnitsByName = new Map();

  if (units !== undefined) {
    await models.RetailProductUnit.destroy({ where: { product_id: productId }, ...opts });
    for (const u of units) {
      const created = await models.RetailProductUnit.create(
        { product_id: productId, ...u },
        opts,
      );
      createdUnitsByName.set(u.unit_name.toLowerCase(), created);
    }
  }

  if (barcodes !== undefined) {
    if (!Array.isArray(barcodes)) {
      throw new AppError("barcodes must be an array.", 400);
    }
    const existingRows = await models.RetailBarcode.findAll({
      where: { product_id: productId },
      ...opts,
    });
    const wanted = new Map();
    for (const item of barcodes) {
      const code = String(typeof item === "string" ? item : item?.barcode || "").trim();
      if (!code) continue;
      if (code.length > 64) throw new AppError("Barcode max length is 64 characters.", 400);
      let unitId = typeof item === "object" && item?.unit_id ? Number(item.unit_id) : null;
      if (!unitId && typeof item === "object" && item?.unit_name) {
        const matched = createdUnitsByName.get(String(item.unit_name).trim().toLowerCase());
        if (matched) unitId = matched.unit_id;
      }
      wanted.set(code, unitId);
    }

    for (const oldRow of existingRows) {
      if (!wanted.has(oldRow.barcode)) {
        await oldRow.destroy(opts);
      }
    }

    for (const [code, unitId] of wanted.entries()) {
      const conflict = await models.RetailBarcode.findByPk(code, {
        include: [{ model: models.RetailProduct, attributes: ["product_id", "name", "code"] }],
        ...opts,
      });
      if (conflict && Number(conflict.product_id) !== Number(productId)) {
        const err = new AppError(
          `Barcode "${code}" is already assigned to ${conflict.RetailProduct?.name || "another product"}.`,
          409,
        );
        err.data = {
          conflict_product: conflict.RetailProduct || { product_id: conflict.product_id },
        };
        throw err;
      }
      if (!conflict) {
        await models.RetailBarcode.create({ barcode: code, product_id: productId, unit_id: unitId }, opts);
      } else if (unitId !== undefined && conflict.unit_id !== unitId) {
        await conflict.update({ unit_id: unitId }, opts);
      }
    }
  }
};

export const createProduct = async (models, userId, body = {}) => {
  const validated = await validateProductInput(models, body, { isUpdate: false });
  const settings = await getRetailSettings(models);
  const codePrefix = settings.codePrefix || "HW-";

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    const parentCat = validated.category.parent_id
      ? await models.RetailCategory.findByPk(validated.category.parent_id, opts)
      : null;

    let family = null;
    if (body.family_id) {
      family = await models.RetailFamily.findByPk(Number(body.family_id), opts);
      if (!family) throw new AppError("Family not found.", 404);
    }

    const rawName = String(body.name || "").trim();
    const generatedName = generateName({
      brand: validated.brand?.name || "",
      category: (parentCat || validated.category).name,
      subCategory: parentCat ? validated.category.name : "",
      itemName: validated.category.item_name || "",
      itemWord: String(body.item_word || "").trim(),
      variant: body.variant_label || "",
      unit: family?.option_unit || "",
      pattern: settings.namePattern,
    });
    const finalName = rawName || generatedName;
    if (!finalName) {
      throw new AppError("Product name could not be determined.", 400);
    }

    const finalNameSi =
      body.name_si !== undefined
        ? body.name_si
        : generateSinhalaName({
            brand: validated.brand?.name || "",
            categorySi: (parentCat || validated.category).name_si || "",
            subCategorySi: parentCat ? validated.category.name_si || "" : "",
            itemNameSi: validated.category.item_name_si || "",
            itemWordSi: String(body.item_word_si || "").trim(),
            variant: body.variant_label || "",
            unit: family?.option_unit || "",
            pattern: settings.namePattern,
          }) || null;

    const createWithCode = async () => {
      const code = String(body.code || "").trim() || (await nextProductCode(models, codePrefix, opts));
      return models.RetailProduct.create(
        {
          code,
          name: finalName,
          name_si: finalNameSi,
          family_id: family ? family.family_id : null,
          variant_label: body.variant_label ? String(body.variant_label).trim() : null,
          category_id: validated.category_id,
          brand_id: validated.brand_id,
          tracking: validated.tracking,
          serial_capture: validated.serial_capture,
          base_unit: validated.base_unit,
          allow_decimal: validated.allow_decimal,
          sell_price: validated.sell_price,
          contractor_price: validated.contractor_price,
          trade_price: validated.trade_price,
          avg_cost: validated.avg_cost,
          last_cost: validated.last_cost,
          reorder_level: validated.reorder_level,
          warranty_months: validated.warranty_months,
          tax_rate_bp: body.tax_rate_bp ?? null,
          image_url: body.image_url ?? null,
          description: body.description ?? null,
          is_active: body.is_active !== undefined ? Boolean(body.is_active) : true,
          created_via: validated.created_via,
          created_by: userId ?? null,
          search_text: "",
        },
        opts,
      );
    };

    const created = body.code ? await createWithCode() : await withProductCodeRetry(createWithCode);

    await syncProductUnitsAndBarcodes(
      models,
      created.product_id,
      { units: validated.units, barcodes: body.barcodes },
      opts,
    );
    await rebuildSearchTextForProducts(models, [created.product_id], opts);

    return loadFullProduct(models, created.product_id, opts);
  });
};

export const updateProduct = async (models, productId, body = {}) => {
  const existing = await models.RetailProduct.findByPk(productId);
  if (!existing) throw new AppError("Product not found.", 404);

  const validated = await validateProductInput(models, body, { isUpdate: true, existing });

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};

    const patch = {
      category_id: validated.category_id,
      brand_id: validated.brand_id,
      tracking: validated.tracking,
      serial_capture: validated.serial_capture,
      base_unit: validated.base_unit,
      allow_decimal: validated.allow_decimal,
      sell_price: validated.sell_price,
      contractor_price: validated.contractor_price,
      trade_price: validated.trade_price,
      avg_cost: validated.avg_cost,
      last_cost: validated.last_cost,
      reorder_level: validated.reorder_level,
      warranty_months: validated.warranty_months,
    };

    if (body.name !== undefined) {
      const n = String(body.name || "").trim();
      if (!n) throw new AppError("name cannot be empty.", 400);
      patch.name = n;
    }
    if (body.name_si !== undefined) patch.name_si = body.name_si;
    if (body.item_name !== undefined) patch.item_name = body.item_name;
    if (body.item_name_si !== undefined) patch.item_name_si = body.item_name_si;
    if (body.code !== undefined) {
      const c = String(body.code || "").trim();
      if (!c) throw new AppError("code cannot be empty.", 400);
      patch.code = c;
    }
    if (body.family_id !== undefined) patch.family_id = body.family_id || null;
    if (body.variant_label !== undefined) patch.variant_label = body.variant_label || null;
    if (body.image_url !== undefined) patch.image_url = body.image_url;
    if (body.description !== undefined) patch.description = body.description;
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
    if (body.tax_rate_bp !== undefined) patch.tax_rate_bp = body.tax_rate_bp;

    await existing.update(patch, opts);
    await syncProductUnitsAndBarcodes(
      models,
      existing.product_id,
      { units: validated.units, barcodes: body.barcodes },
      opts,
    );
    await rebuildSearchTextForProducts(models, [existing.product_id], opts);

    return loadFullProduct(models, existing.product_id, opts);
  });
};

export const archiveProduct = async (models, productId, { is_active = false } = {}) => {
  const product = await models.RetailProduct.findByPk(productId);
  if (!product) throw new AppError("Product not found.", 404);
  await product.update({ is_active: Boolean(is_active) });
  return loadFullProduct(models, product.product_id);
};

export const getProductById = async (models, productId) => {
  const product = await loadFullProduct(models, productId);
  if (!product) throw new AppError("Product not found.", 404);
  const plain = typeof product.toJSON === "function" ? product.toJSON() : product;
  const cat = plain.RetailCategory || null;
  const categoryPath = cat?.Parent ? [cat.Parent, cat] : cat ? [cat] : [];
  return {
    ...plain,
    category_path: categoryPath,
    stock: null, // R2 will populate stock levels
  };
};

export const lookupProductByCode = async (models, rawCode) => {
  const code = String(rawCode || "").trim();
  if (!code) throw new AppError("code query parameter is required.", 400);

  const barcodeRow = await models.RetailBarcode.findByPk(code, {
    include: [
      { model: models.RetailProductUnit, as: "Unit" },
      {
        model: models.RetailProduct,
        include: [
          { model: models.RetailCategory, include: [{ model: models.RetailCategory, as: "Parent" }] },
          { model: models.RetailBrand },
          { model: models.RetailFamily },
          { model: models.RetailProductUnit, as: "Units" },
          { model: models.RetailBarcode, as: "Barcodes" },
        ],
      },
    ],
  });

  if (barcodeRow?.RetailProduct) {
    return {
      product: barcodeRow.RetailProduct,
      unit: barcodeRow.Unit || null,
      matched_by: "barcode",
    };
  }

  const product = await models.RetailProduct.findOne({
    where: { code },
    include: [
      { model: models.RetailCategory, include: [{ model: models.RetailCategory, as: "Parent" }] },
      { model: models.RetailBrand },
      { model: models.RetailFamily },
      { model: models.RetailProductUnit, as: "Units" },
      { model: models.RetailBarcode, as: "Barcodes" },
    ],
  });

  if (!product) throw new AppError("Product not found.", 404);
  return { product, unit: null, matched_by: "code" };
};

export const listProducts = async (
  models,
  {
    q,
    category_id,
    brand_id,
    family_id,
    tracking,
    active = "true",
    page = 1,
    limit = 20,
    skip_count = false,
  } = {},
) => {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const offset = (safePage - 1) * safeLimit;
  const skipCount = skip_count === "true" || skip_count === true;

  const where = {};
  if (active === "true" || active === true) where.is_active = true;
  else if (active === "false" || active === false) where.is_active = false;

  if (brand_id) where.brand_id = Number(brand_id);
  if (family_id) where.family_id = Number(family_id);
  if (tracking) {
    if (!RETAIL_TRACKING_TYPES.includes(tracking)) {
      throw new AppError("Invalid tracking filter.", 400);
    }
    where.tracking = tracking;
  }

  if (category_id) {
    const catId = Number(category_id);
    const children = await models.RetailCategory.findAll({
      where: { parent_id: catId },
      attributes: ["category_id"],
      raw: true,
    });
    const catIds = [catId, ...children.map((c) => c.category_id)];
    where.category_id = { [Op.in]: catIds };
  }

  if (q && String(q).trim()) {
    const aliases = await models.RetailSearchAlias.findAll({ raw: true });
    const words = parseSearchQueryWords(q, aliases);
    if (words.length > 0) {
      where[Op.and] = words.map((w) => ({
        search_text: { [Op.like]: `%${escapeLike(w)}%` },
      }));
    }
  }

  const include = [
    { model: models.RetailCategory, include: [{ model: models.RetailCategory, as: "Parent" }] },
    { model: models.RetailBrand },
    { model: models.RetailFamily },
    { model: models.RetailProductUnit, as: "Units" },
    { model: models.RetailBarcode, as: "Barcodes" },
  ];

  if (skipCount) {
    const rows = await models.RetailProduct.findAll({
      where,
      include,
      order: [["updatedAt", "DESC"], ["product_id", "DESC"]],
      limit: safeLimit,
      offset,
    });
    return { products: rows, page: safePage, limit: safeLimit };
  }

  const { count, rows } = await models.RetailProduct.findAndCountAll({
    where,
    include,
    distinct: true,
    col: "product_id",
    order: [["updatedAt", "DESC"], ["product_id", "DESC"]],
    limit: safeLimit,
    offset,
  });

  return { products: rows, total: count, page: safePage, limit: safeLimit };
};

export const createFamily = async (models, userId, body = {}) => {
  const {
    name,
    name_si = null,
    category_id,
    brand_id = null,
    option_label = "Size",
    option_unit = null,
    item_word = "",
    variants,
    shared = {},
  } = body;

  if (!Array.isArray(variants) || variants.length === 0) {
    throw new AppError("variants must be a non-empty array.", 400);
  }

  const category = await models.RetailCategory.findByPk(Number(category_id));
  if (!category) throw new AppError("Category not found.", 404);

  let brand = null;
  if (brand_id) {
    brand = await models.RetailBrand.findByPk(Number(brand_id));
    if (!brand) throw new AppError("Brand not found.", 404);
  }

  const settings = await getRetailSettings(models);
  const codePrefix = settings.codePrefix || "HW-";

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    const parentCat = category.parent_id
      ? await models.RetailCategory.findByPk(category.parent_id, opts)
      : null;

    const familyName =
      String(name || "").trim() ||
      generateName({
        brand: brand?.name || "",
        category: (parentCat || category).name,
        subCategory: parentCat ? category.name : "",
        itemName: category.item_name || "",
        itemWord: String(item_word || "").trim(),
        variant: "",
        unit: "",
        pattern: settings.namePattern,
      });

    if (!familyName) {
      throw new AppError("Family name is required.", 400);
    }

    const family = await models.RetailFamily.create(
      {
        name: familyName,
        name_si,
        category_id: category.category_id,
        brand_id: brand ? brand.brand_id : null,
        option_label: String(option_label || "Size").slice(0, 40),
        option_unit: option_unit ? String(option_unit).slice(0, 10) : null,
      },
      opts,
    );

    const createdProducts = [];
    for (const v of variants) {
      const variantLabel = String(v?.variant_label || "").trim();
      if (!variantLabel) {
        throw new AppError("Each variant must include variant_label.", 400);
      }
      const productPayload = {
        ...shared,
        category_id: category.category_id,
        brand_id: brand ? brand.brand_id : null,
        family_id: family.family_id,
        variant_label: variantLabel,
        sell_price: v.sell_price,
        contractor_price: v.contractor_price ?? null,
        trade_price: v.trade_price ?? null,
        avg_cost: v.cost ?? shared.avg_cost ?? 0,
        last_cost: v.cost ?? shared.last_cost ?? null,
        barcodes: v.barcode ? [v.barcode] : v.barcodes,
        name:
          v.name ||
          generateName({
            brand: brand?.name || "",
            category: (parentCat || category).name,
            subCategory: parentCat ? category.name : "",
            itemName: category.item_name || "",
            itemWord: String(item_word || "").trim(),
            variant: variantLabel,
            unit: family.option_unit || "",
            pattern: settings.namePattern,
          }),
      };

      const validated = await validateProductInput(models, productPayload, { isUpdate: false });
      const createWithCode = async () => {
        const code = await nextProductCode(models, codePrefix, opts);
        return models.RetailProduct.create(
          {
            code,
            name: String(productPayload.name).trim(),
            name_si: v.name_si || null,
            family_id: family.family_id,
            variant_label: variantLabel,
            category_id: validated.category_id,
            brand_id: validated.brand_id,
            tracking: validated.tracking,
            serial_capture: validated.serial_capture,
            base_unit: validated.base_unit,
            allow_decimal: validated.allow_decimal,
            sell_price: validated.sell_price,
            contractor_price: validated.contractor_price,
            trade_price: validated.trade_price,
            avg_cost: validated.avg_cost,
            last_cost: validated.last_cost,
            reorder_level: validated.reorder_level,
            warranty_months: validated.warranty_months,
            is_active: true,
            created_via: "catalog",
            created_by: userId ?? null,
            search_text: "",
          },
          opts,
        );
      };

      const prod = await withProductCodeRetry(createWithCode);
      await syncProductUnitsAndBarcodes(
        models,
        prod.product_id,
        { units: validated.units, barcodes: productPayload.barcodes },
        opts,
      );
      createdProducts.push(prod);
    }

    await rebuildSearchTextForProducts(
      models,
      createdProducts.map((p) => p.product_id),
      opts,
    );

    const hydrated = [];
    for (const p of createdProducts) {
      hydrated.push(await loadFullProduct(models, p.product_id, opts));
    }
    return { family, products: hydrated };
  });
};

export const updateFamily = async (models, familyId, body = {}) => {
  const family = await models.RetailFamily.findByPk(familyId);
  if (!family) throw new AppError("Family not found.", 404);

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    const patch = {};
    if (body.name !== undefined) {
      const n = String(body.name || "").trim();
      if (!n) throw new AppError("Family name cannot be empty.", 400);
      patch.name = n;
    }
    if (body.name_si !== undefined) patch.name_si = body.name_si;
    if (body.item_name !== undefined) patch.item_name = body.item_name;
    if (body.item_name_si !== undefined) patch.item_name_si = body.item_name_si;
    if (body.category_id !== undefined) patch.category_id = Number(body.category_id);
    if (body.brand_id !== undefined) patch.brand_id = body.brand_id ? Number(body.brand_id) : null;
    if (body.option_label !== undefined) patch.option_label = String(body.option_label).slice(0, 40);
    if (body.option_unit !== undefined) patch.option_unit = body.option_unit ? String(body.option_unit).slice(0, 10) : null;

    await family.update(patch, opts);

    const siblings = await models.RetailProduct.findAll({
      where: { family_id: family.family_id },
      attributes: ["product_id"],
      raw: true,
      ...opts,
    });
    await rebuildSearchTextForProducts(
      models,
      siblings.map((s) => s.product_id),
      opts,
    );
    return family;
  });
};

export const addFamilyVariants = async (models, familyId, userId, body = {}) => {
  const family = await models.RetailFamily.findByPk(familyId);
  if (!family) throw new AppError("Family not found.", 404);

  const variants = Array.isArray(body.variants) ? body.variants : [];
  if (variants.length === 0) {
    throw new AppError("variants must be a non-empty array.", 400);
  }

  const sibling = await models.RetailProduct.findOne({
    where: { family_id: family.family_id },
  });
  const shared = {
    tracking: sibling?.tracking || "counted",
    serial_capture: sibling?.serial_capture || null,
    base_unit: sibling?.base_unit || "pcs",
    allow_decimal: sibling?.allow_decimal ?? false,
    reorder_level: sibling?.reorder_level ?? null,
    warranty_months: sibling?.warranty_months ?? null,
    ...(body.shared || {}),
  };

  const settings = await getRetailSettings(models);
  const codePrefix = settings.codePrefix || "HW-";

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    const createdProducts = [];

    for (const v of variants) {
      const variantLabel = String(v?.variant_label || "").trim();
      if (!variantLabel) {
        throw new AppError("Each variant must include variant_label.", 400);
      }
      const productPayload = {
        ...shared,
        category_id: family.category_id,
        brand_id: family.brand_id,
        family_id: family.family_id,
        variant_label: variantLabel,
        sell_price: v.sell_price,
        contractor_price: v.contractor_price ?? null,
        trade_price: v.trade_price ?? null,
        avg_cost: v.cost ?? shared.avg_cost ?? 0,
        last_cost: v.cost ?? shared.last_cost ?? null,
        barcodes: v.barcode ? [v.barcode] : v.barcodes,
      };
      const validated = await validateProductInput(models, productPayload, { isUpdate: false });
      const createWithCode = async () => {
        const code = await nextProductCode(models, codePrefix, opts);
        return models.RetailProduct.create(
          {
            code,
            name: String(v.name || `${family.name} ${variantLabel}${family.option_unit && !variantLabel.endsWith(family.option_unit) ? family.option_unit : ""}`).trim(),
            name_si: v.name_si || null,
            family_id: family.family_id,
            variant_label: variantLabel,
            category_id: validated.category_id,
            brand_id: validated.brand_id,
            tracking: validated.tracking,
            serial_capture: validated.serial_capture,
            base_unit: validated.base_unit,
            allow_decimal: validated.allow_decimal,
            sell_price: validated.sell_price,
            contractor_price: validated.contractor_price,
            trade_price: validated.trade_price,
            avg_cost: validated.avg_cost,
            last_cost: validated.last_cost,
            reorder_level: validated.reorder_level,
            warranty_months: validated.warranty_months,
            is_active: true,
            created_via: "catalog",
            created_by: userId ?? null,
            search_text: "",
          },
          opts,
        );
      };
      const prod = await withProductCodeRetry(createWithCode);
      await syncProductUnitsAndBarcodes(
        models,
        prod.product_id,
        { units: validated.units, barcodes: productPayload.barcodes },
        opts,
      );
      createdProducts.push(prod);
    }

    await rebuildSearchTextForProducts(
      models,
      createdProducts.map((p) => p.product_id),
      opts,
    );
    const hydrated = [];
    for (const p of createdProducts) {
      hydrated.push(await loadFullProduct(models, p.product_id, opts));
    }
    return { family, products: hydrated };
  });
};

export const listCategoriesTree = async (models) => {
  await ensureStarterCatalog(models);
  const [cats, products] = await Promise.all([
    models.RetailCategory.findAll({
      order: [["sort_order", "ASC"], ["category_id", "ASC"]],
      raw: true,
    }),
    models.RetailProduct.findAll({
      attributes: ["category_id"],
      where: { is_active: true },
      raw: true,
    }),
  ]);

  const directCounts = new Map();
  for (const p of products || []) {
    directCounts.set(p.category_id, (directCounts.get(p.category_id) || 0) + 1);
  }

  const nodesById = new Map();
  const roots = [];

  for (const c of cats) {
    const node = {
      ...c,
      usual_sizes: parseJsonField(c.usual_sizes),
      attributes: parseJsonField(c.attributes),
      product_count: directCounts.get(c.category_id) || 0,
      children: [],
    };
    nodesById.set(c.category_id, node);
  }

  for (const node of nodesById.values()) {
    if (node.parent_id && nodesById.has(node.parent_id)) {
      const parent = nodesById.get(node.parent_id);
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  for (const root of roots) {
    const childrenSum = root.children.reduce((acc, ch) => acc + ch.product_count, 0);
    root.product_count += childrenSum;
  }

  return roots;
};

export const createCategory = async (models, body = {}) => {
  const name = String(body.name || "").trim();
  if (!name) throw new AppError("Category name is required.", 400);

  if (body.parent_id) {
    const parent = await models.RetailCategory.findByPk(Number(body.parent_id));
    if (!parent) throw new AppError("Parent category not found.", 404);
    if (parent.parent_id) {
      throw new AppError("Categories can only be two levels deep.", 400);
    }
  }

  return models.RetailCategory.create({
    parent_id: body.parent_id ? Number(body.parent_id) : null,
    name,
    name_si: body.name_si || null,
    item_name: body.item_name || null,
    item_name_si: body.item_name_si || null,
    image_url: body.image_url || null,
    icon: body.icon || null,
    usual_sizes: body.usual_sizes ?? null,
    attributes: body.attributes ?? null,
    default_unit: body.default_unit || null,
    sort_order: Number(body.sort_order) || 0,
    is_active: body.is_active !== undefined ? Boolean(body.is_active) : true,
  });
};

export const updateCategory = async (models, categoryId, body = {}) => {
  const category = await models.RetailCategory.findByPk(categoryId);
  if (!category) throw new AppError("Category not found.", 404);

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    const patch = {};
    if (body.name !== undefined) {
      const n = String(body.name || "").trim();
      if (!n) throw new AppError("Category name cannot be empty.", 400);
      patch.name = n;
    }
    if (body.name_si !== undefined) patch.name_si = body.name_si;
    if (body.item_name !== undefined) patch.item_name = body.item_name;
    if (body.item_name_si !== undefined) patch.item_name_si = body.item_name_si;
    if (body.image_url !== undefined) patch.image_url = body.image_url;
    if (body.icon !== undefined) patch.icon = body.icon;
    if (body.usual_sizes !== undefined) patch.usual_sizes = body.usual_sizes;
    if (body.attributes !== undefined) patch.attributes = body.attributes;
    if (body.default_unit !== undefined) patch.default_unit = body.default_unit;
    if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order) || 0;
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

    await category.update(patch, opts);

    if (patch.name !== undefined || patch.name_si !== undefined) {
      const children = await models.RetailCategory.findAll({
        where: { parent_id: category.category_id },
        attributes: ["category_id"],
        raw: true,
        ...opts,
      });
      const catIds = [category.category_id, ...children.map((c) => c.category_id)];
      const products = await models.RetailProduct.findAll({
        where: { category_id: { [Op.in]: catIds } },
        attributes: ["product_id"],
        raw: true,
        ...opts,
      });
      await rebuildSearchTextForProducts(
        models,
        products.map((p) => p.product_id),
        opts,
      );
    }

    return category;
  });
};

export const deleteCategory = async (models, categoryId) => {
  const category = await models.RetailCategory.findByPk(categoryId);
  if (!category) throw new AppError("Category not found.", 404);

  const [childCount, productCount, familyCount] = await Promise.all([
    models.RetailCategory.count({ where: { parent_id: category.category_id } }),
    models.RetailProduct.count({ where: { category_id: category.category_id } }),
    models.RetailFamily.count({ where: { category_id: category.category_id } }),
  ]);

  if (childCount > 0) {
    throw new AppError("Cannot delete a category that has sub-categories.", 409);
  }
  if (productCount > 0 || familyCount > 0) {
    throw new AppError("Cannot delete a category that still contains products or families.", 409);
  }

  await category.destroy();
  return { deleted: true, category_id: category.category_id };
};

export const mergeCategoryInto = async (models, sourceId, targetId) => {
  const srcId = Number(sourceId);
  const dstId = Number(targetId);
  if (srcId === dstId) {
    throw new AppError("Cannot merge a category into itself.", 400);
  }

  const [source, target] = await Promise.all([
    models.RetailCategory.findByPk(srcId),
    models.RetailCategory.findByPk(dstId),
  ]);
  if (!source) throw new AppError("Source category not found.", 404);
  if (!target) throw new AppError("Target category not found.", 404);

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};

    const affectedProducts = await models.RetailProduct.findAll({
      where: { category_id: srcId },
      attributes: ["product_id"],
      raw: true,
      ...opts,
    });

    await models.RetailProduct.update(
      { category_id: dstId },
      { where: { category_id: srcId }, ...opts },
    );
    await models.RetailFamily.update(
      { category_id: dstId },
      { where: { category_id: srcId }, ...opts },
    );
    if (!target.parent_id) {
      await models.RetailCategory.update(
        { parent_id: dstId },
        { where: { parent_id: srcId }, ...opts },
      );
    }

    await rebuildSearchTextForProducts(
      models,
      affectedProducts.map((p) => p.product_id),
      opts,
    );

    await source.destroy(opts);
    return {
      merged_from: srcId,
      merged_into: dstId,
      moved_products: affectedProducts.length,
    };
  });
};

export const listBrands = async (models) =>
  models.RetailBrand.findAll({ order: [["name", "ASC"]] });

export const createBrand = async (models, body = {}) => {
  const name = String(body.name || "").trim();
  if (!name) throw new AppError("Brand name is required.", 400);
  return models.RetailBrand.create({
    name,
    logo_url: body.logo_url || null,
    is_active: body.is_active !== undefined ? Boolean(body.is_active) : true,
  });
};

export const updateBrand = async (models, brandId, body = {}) => {
  const brand = await models.RetailBrand.findByPk(brandId);
  if (!brand) throw new AppError("Brand not found.", 404);

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    const patch = {};
    if (body.name !== undefined) {
      const n = String(body.name || "").trim();
      if (!n) throw new AppError("Brand name cannot be empty.", 400);
      patch.name = n;
    }
    if (body.logo_url !== undefined) patch.logo_url = body.logo_url;
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

    await brand.update(patch, opts);

    if (patch.name !== undefined) {
      const products = await models.RetailProduct.findAll({
        where: { brand_id: brand.brand_id },
        attributes: ["product_id"],
        raw: true,
        ...opts,
      });
      await rebuildSearchTextForProducts(
        models,
        products.map((p) => p.product_id),
        opts,
      );
    }
    return brand;
  });
};

const rebuildForAliasMeans = async (models, meansList, { transaction } = {}) => {
  const opts = transaction ? { transaction } : {};
  const clauses = [...new Set(meansList.filter(Boolean))].map((m) => ({
    search_text: { [Op.like]: `%${escapeLike(String(m).toLowerCase())}%` },
  }));
  if (clauses.length === 0) return;

  const affected = await models.RetailProduct.findAll({
    where: { [Op.or]: clauses },
    attributes: ["product_id"],
    raw: true,
    ...opts,
  });
  await rebuildSearchTextForProducts(
    models,
    affected.map((p) => p.product_id),
    opts,
  );
};

export const listAliases = async (models) =>
  models.RetailSearchAlias.findAll({ order: [["term", "ASC"]] });

export const createAlias = async (models, body = {}) => {
  const term = String(body.term || "").trim().toLowerCase();
  const means = String(body.means || "").trim().toLowerCase();
  if (!term || !means) throw new AppError("term and means are required.", 400);

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    const alias = await models.RetailSearchAlias.create({ term, means }, opts);
    await rebuildForAliasMeans(models, [means], opts);
    return alias;
  });
};

export const updateAlias = async (models, aliasId, body = {}) => {
  const alias = await models.RetailSearchAlias.findByPk(aliasId);
  if (!alias) throw new AppError("Alias not found.", 404);

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    const oldMeans = alias.means;
    const term = body.term !== undefined ? String(body.term).trim().toLowerCase() : alias.term;
    const means = body.means !== undefined ? String(body.means).trim().toLowerCase() : alias.means;
    if (!term || !means) throw new AppError("term and means cannot be empty.", 400);

    await alias.update({ term, means }, opts);
    await rebuildForAliasMeans(models, [oldMeans, means], opts);
    return alias;
  });
};

export const deleteAlias = async (models, aliasId) => {
  const alias = await models.RetailSearchAlias.findByPk(aliasId);
  if (!alias) throw new AppError("Alias not found.", 404);

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    const oldMeans = alias.means;
    await alias.destroy(opts);
    await rebuildForAliasMeans(models, [oldMeans], opts);
    return { deleted: true, alias_id: alias.alias_id };
  });
};

export const learnBarcode = async (models, { barcode, product_id, unit_id = null } = {}) => {
  const code = String(barcode || "").trim();
  const productId = Number(product_id);
  if (!code || code.length > 64) {
    throw new AppError("A valid barcode (1-64 characters) is required.", 400);
  }
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new AppError("product_id is required.", 400);
  }

  const product = await models.RetailProduct.findByPk(productId);
  if (!product) throw new AppError("Product not found.", 404);

  let resolvedUnitId = null;
  if (unit_id !== null && unit_id !== undefined && unit_id !== "") {
    const uid = Number(unit_id);
    const unit = await models.RetailProductUnit.findOne({
      where: { unit_id: uid, product_id: productId },
    });
    if (!unit) throw new AppError("Unit not found for this product.", 404);
    resolvedUnitId = uid;
  }

  const existing = await models.RetailBarcode.findByPk(code, {
    include: [{ model: models.RetailProduct, attributes: ["product_id", "name", "code"] }],
  });

  if (existing && Number(existing.product_id) !== productId) {
    const err = new AppError(
      `Barcode "${code}" already belongs to ${existing.RetailProduct?.name || "another product"}.`,
      409,
    );
    err.data = {
      conflict_product: existing.RetailProduct || { product_id: existing.product_id },
    };
    throw err;
  }

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    let row = existing;
    if (!row) {
      row = await models.RetailBarcode.create(
        { barcode: code, product_id: productId, unit_id: resolvedUnitId },
        opts,
      );
    } else if (row.unit_id !== resolvedUnitId) {
      await row.update({ unit_id: resolvedUnitId }, opts);
    }

    await rebuildSearchTextForProducts(models, [productId], opts);
    return row;
  });
};

export const getPosCatalog = async (models, { since } = {}) => {
  const serverTime = new Date().toISOString();
  let sinceDate = null;
  if (since) {
    const parsed = new Date(since);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError("Invalid since timestamp.", 400);
    }
    sinceDate = parsed;
  }

  const productWhere = { is_active: true };
  if (sinceDate) {
    productWhere.updatedAt = { [Op.gt]: sinceDate };
  }

  const [products, archivedRows, categories, brands, families] = await Promise.all([
    models.RetailProduct.findAll({
      where: productWhere,
      attributes: [
        "product_id",
        "code",
        "name",
        "name_si",
        "family_id",
        "variant_label",
        "category_id",
        "brand_id",
        "tracking",
        "serial_capture",
        "base_unit",
        "allow_decimal",
        "sell_price",
        "contractor_price",
        "trade_price",
        "avg_cost",
        "last_cost",
        "search_text",
        "updatedAt",
      ],
      include: [
        { model: models.RetailProductUnit, as: "Units", attributes: ["unit_id", "unit_name", "factor", "sell_price", "is_default_sale"] },
        { model: models.RetailBarcode, as: "Barcodes", attributes: ["barcode", "unit_id"] },
      ],
      order: [["product_id", "ASC"]],
    }),
    sinceDate
      ? models.RetailProduct.findAll({
          where: { is_active: false, updatedAt: { [Op.gt]: sinceDate } },
          attributes: ["product_id"],
          raw: true,
        })
      : Promise.resolve([]),
    models.RetailCategory.findAll({
      where: { is_active: true },
      attributes: ["category_id", "parent_id", "name", "name_si", "item_name", "item_name_si", "icon", "default_unit", "sort_order"],
      order: [["sort_order", "ASC"], ["category_id", "ASC"]],
      raw: true,
    }),
    models.RetailBrand.findAll({
      where: { is_active: true },
      attributes: ["brand_id", "name"],
      order: [["name", "ASC"]],
      raw: true,
    }),
    models.RetailFamily.findAll({
      attributes: ["family_id", "name", "name_si", "category_id", "brand_id", "option_label", "option_unit"],
      order: [["family_id", "ASC"]],
      raw: true,
    }),
  ]);

  return {
    server_time: serverTime,
    products,
    archived_ids: (archivedRows || []).map((r) => r.product_id),
    categories,
    brands,
    families,
  };
};
