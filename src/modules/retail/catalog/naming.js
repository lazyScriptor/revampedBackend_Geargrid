import { Op } from "sequelize";

export const DEFAULT_NAME_PATTERN = "{brand} {subcategory} {item} {variant}{unit}";

/**
 * Expand size/variant labels into multiple searchable forms:
 * e.g. ("6", "mm") or ("6mm", "") -> ["6mm", "6 mm", "6", "6.0"]
 */
export const expandSizeTokens = (variant, unit = "") => {
  const tokens = new Set();
  const v = String(variant || "").trim();
  const u = String(unit || "").trim();
  if (!v) return [];

  const combined = u && !v.toLowerCase().endsWith(u.toLowerCase()) ? `${v}${u}` : v;
  tokens.add(combined.toLowerCase());
  tokens.add(v.toLowerCase());

  const numUnitMatch = combined.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/);
  if (numUnitMatch) {
    const numStr = numUnitMatch[1];
    const numVal = Number(numStr);
    const unitStr = numUnitMatch[2].toLowerCase();
    tokens.add(`${numStr}${unitStr}`);
    tokens.add(`${numStr} ${unitStr}`);
    tokens.add(numStr);
    if (Number.isFinite(numVal)) {
      tokens.add(numVal.toFixed(1));
      if (Number.isInteger(numVal)) {
        tokens.add(String(numVal));
      }
    }
  }

  const inchMatch = combined.match(/^(\d+(?:\/\d+|\.\d+)?)"$/);
  if (inchMatch) {
    tokens.add(inchMatch[1].toLowerCase());
    tokens.add(`${inchMatch[1].toLowerCase()} inch`);
    tokens.add(`${inchMatch[1].toLowerCase()}"`);
  }

  return [...tokens].filter(Boolean);
};

const formatPattern = ({ brand, subCategory, category, itemWord, variant, unit, pattern }) => {
  const tpl = pattern || DEFAULT_NAME_PATTERN;
  const v = String(variant || "").trim();
  const u = String(unit || "").trim();
  const variantHasUnit = v && u && v.toLowerCase().endsWith(u.toLowerCase());
  const effectiveUnit = variantHasUnit || !v ? "" : u;

  const filled = tpl
    .replace(/\{brand\}/gi, String(brand || "").trim())
    .replace(/\{subcategory\}/gi, String(subCategory || "").trim())
    .replace(/\{category\}/gi, String(category || "").trim())
    .replace(/\{item\}/gi, String(itemWord || "").trim())
    .replace(/\{name\}/gi, String(itemWord || "").trim())
    .replace(/\{variant\}/gi, v)
    .replace(/\{unit\}/gi, effectiveUnit);

  return filled.replace(/\s+/g, " ").trim();
};

export const generateName = ({
  brand = "",
  subCategory = "",
  category = "",
  itemWord = "",
  variant = "",
  unit = "",
  pattern = DEFAULT_NAME_PATTERN,
} = {}) =>
  formatPattern({ brand, subCategory, category, itemWord, variant, unit, pattern });

export const generateSinhalaName = ({
  brand = "",
  subCategorySi = "",
  categorySi = "",
  itemWordSi = "",
  variant = "",
  unit = "",
  pattern = DEFAULT_NAME_PATTERN,
} = {}) =>
  formatPattern({
    brand,
    subCategory: subCategorySi,
    category: categorySi,
    itemWord: itemWordSi,
    variant,
    unit,
    pattern,
  });

const splitWords = (value) =>
  String(value || "")
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

/**
 * Build deduplicated lower-case `search_text` for a retail product.
 */
export const buildSearchText = (
  product = {},
  {
    category = null,
    subCategory = null,
    family = null,
    brand = null,
    units = [],
    barcodes = [],
    aliases = [],
  } = {},
) => {
  const tokenSet = new Set();
  const addText = (txt) => {
    for (const w of splitWords(txt)) tokenSet.add(w);
  };

  addText(product.name);
  addText(product.name_si);
  addText(product.code);
  addText(product.variant_label);
  addText(brand?.name);
  addText(category?.name);
  addText(category?.name_si);
  addText(subCategory?.name);
  addText(subCategory?.name_si);
  addText(family?.name);
  addText(family?.name_si);

  for (const sizeToken of expandSizeTokens(product.variant_label, family?.option_unit)) {
    tokenSet.add(sizeToken);
  }

  for (const u of units || []) {
    addText(typeof u === "string" ? u : u?.unit_name);
  }

  for (const b of barcodes || []) {
    const code = typeof b === "string" ? b : b?.barcode;
    if (code) tokenSet.add(String(code).trim().toLowerCase());
  }

  const baseText = [...tokenSet].join(" ");
  for (const alias of aliases || []) {
    const means = String(alias?.means || "").trim().toLowerCase();
    const term = String(alias?.term || "").trim().toLowerCase();
    if (!means || !term) continue;
    if (baseText.includes(means)) {
      tokenSet.add(term);
    }
  }

  return [...tokenSet].join(" ");
};

/**
 * Escape `%`, `_`, and `\` for SQL LIKE '%word%' queries.
 */
export const escapeLike = (str) =>
  String(str || "").replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * Parse a user search string into normalized search words after alias expansion.
 */
export const parseSearchQueryWords = (q, aliases = []) => {
  const rawWords = splitWords(q);
  if (rawWords.length === 0) return [];

  const aliasMap = new Map();
  for (const a of aliases || []) {
    const term = String(a?.term || "").trim().toLowerCase();
    const means = String(a?.means || "").trim().toLowerCase();
    if (term && means) aliasMap.set(term, means);
  }

  const expanded = [];
  for (const w of rawWords) {
    const mapped = aliasMap.get(w);
    if (mapped) {
      for (const mw of splitWords(mapped)) {
        expanded.push(mw);
      }
    } else {
      expanded.push(w);
    }
  }
  return [...new Set(expanded)];
};

/**
 * Compute the next sequential product code (e.g. HW-00001).
 */
export const nextProductCode = async (models, prefix = "HW-", { transaction } = {}) => {
  const safePrefix = String(prefix || "HW-").trim() || "HW-";
  const rows = await models.RetailProduct.findAll({
    where: { code: { [Op.like]: `${escapeLike(safePrefix)}%` } },
    attributes: ["code"],
    raw: true,
    ...(transaction ? { transaction } : {}),
  });

  let maxNum = 0;
  for (const row of rows || []) {
    const code = String(row.code || "");
    if (!code.startsWith(safePrefix)) continue;
    const suffix = code.slice(safePrefix.length);
    if (/^\d+$/.test(suffix)) {
      const n = Number(suffix);
      if (n > maxNum) maxNum = n;
    }
  }

  return `${safePrefix}${String(maxNum + 1).padStart(5, "0")}`;
};

export const isUniqueCodeError = (err) =>
  err?.name === "SequelizeUniqueConstraintError" ||
  err?.original?.code === "ER_DUP_ENTRY" ||
  err?.parent?.code === "ER_DUP_ENTRY";

/**
 * Retry a create callback up to 5 times on product code unique-key clash.
 */
export const withProductCodeRetry = async (fn, maxAttempts = 5) => {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!isUniqueCodeError(err) || attempt === maxAttempts) {
        throw err;
      }
    }
  }
  throw lastErr;
};
