import { Op } from "sequelize";
import AppError from "../../../utils/AppError.js";
import { ensureStarterCatalog } from "./starterService.js";
import { escapeLike, parseSearchQueryWords } from "./naming.js";

const buildCategoryPath = (catId, categoriesById) => {
  const cat = categoriesById.get(Number(catId));
  if (!cat) return [];
  const parent = cat.parent_id ? categoriesById.get(Number(cat.parent_id)) : null;
  const toNode = (c) => ({
    category_id: c.category_id,
    id: c.category_id,
    name: c.name,
    name_si: c.name_si,
    icon: c.icon,
  });
  return parent ? [toNode(parent), toNode(cat)] : [toNode(cat)];
};

const groupProductsByFamily = (
  products,
  { familiesById, brandsById, categoriesById },
) => {
  const groupsMap = new Map();

  for (const p of products) {
    const fam = p.family_id ? familiesById.get(Number(p.family_id)) : null;
    const groupKey = fam ? `f:${fam.family_id}` : `p:${p.product_id}`;

    if (!groupsMap.has(groupKey)) {
      const brandRow = brandsById.get(Number(fam?.brand_id ?? p.brand_id)) || null;
      const brand = brandRow
        ? { brand_id: brandRow.brand_id, id: brandRow.brand_id, name: brandRow.name }
        : null;
      const categoryPath = buildCategoryPath(fam?.category_id ?? p.category_id, categoriesById);

      groupsMap.set(groupKey, {
        family: fam
          ? {
              family_id: fam.family_id,
              id: fam.family_id,
              name: fam.name,
              name_si: fam.name_si,
              option_label: fam.option_label,
              option_unit: fam.option_unit,
              brand,
              category_path: categoryPath,
            }
          : {
              family_id: null,
              id: null,
              name: p.name,
              name_si: p.name_si || null,
              option_label: null,
              option_unit: null,
              brand,
              category_path: categoryPath,
            },
        variants: [],
      });
    }

    groupsMap.get(groupKey).variants.push({
      product_id: p.product_id,
      variant_label: p.variant_label || null,
      code: p.code,
      name: p.name,
      sell_price: p.sell_price,
      contractor_price: p.contractor_price,
      base_unit: p.base_unit,
      tracking: p.tracking,
    });
  }

  return [...groupsMap.values()];
};

export const searchFinder = async (models, { q = "", limit = 30 } = {}) => {
  const startedAt = Date.now();
  await ensureStarterCatalog(models);

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
  const trimmedQ = String(q || "").trim();

  const [aliases, categories, brands, families] = await Promise.all([
    models.RetailSearchAlias.findAll({ attributes: ["term", "means"], raw: true }),
    models.RetailCategory.findAll({
      attributes: ["category_id", "parent_id", "name", "name_si", "icon"],
      raw: true,
    }),
    models.RetailBrand.findAll({ attributes: ["brand_id", "name"], raw: true }),
    models.RetailFamily.findAll({
      attributes: ["family_id", "name", "name_si", "category_id", "brand_id", "option_label", "option_unit"],
      raw: true,
    }),
  ]);

  const categoriesById = new Map(categories.map((c) => [Number(c.category_id), c]));
  const brandsById = new Map(brands.map((b) => [Number(b.brand_id), b]));
  const familiesById = new Map(families.map((f) => [Number(f.family_id), f]));

  const words = parseSearchQueryWords(trimmedQ, aliases);
  const productAttrs = [
    "product_id",
    "code",
    "name",
    "name_si",
    "family_id",
    "variant_label",
    "category_id",
    "brand_id",
    "sell_price",
    "contractor_price",
    "base_unit",
    "tracking",
    "last_sold_at",
    "last_received_at",
    "updatedAt",
  ];

  let exactBarcodeProductId = null;
  if (trimmedQ && !/\s/.test(trimmedQ)) {
    const bc = await models.RetailBarcode.findByPk(trimmedQ, {
      attributes: ["product_id"],
      raw: true,
    });
    if (bc?.product_id) exactBarcodeProductId = Number(bc.product_id);
  }

  const where = { is_active: true };
  if (words.length > 0) {
    const likeAnd = words.map((w) => ({
      search_text: { [Op.like]: `%${escapeLike(w)}%` },
    }));
    if (exactBarcodeProductId) {
      where[Op.or] = [{ product_id: exactBarcodeProductId }, { [Op.and]: likeAnd }];
    } else {
      where[Op.and] = likeAnd;
    }
  }

  const candidates = await models.RetailProduct.findAll({
    where,
    attributes: productAttrs,
    order: [
      ["last_sold_at", "DESC"],
      ["last_received_at", "DESC"],
      ["updatedAt", "DESC"],
    ],
    limit: 250,
    raw: true,
  });

  // If a matched product belongs to a family, include its active sibling variants so size chips stay complete
  const familyIds = [
    ...new Set(candidates.map((p) => p.family_id).filter(Boolean).map(Number)),
  ];
  let allProducts = candidates;
  if (familyIds.length > 0) {
    const siblings = await models.RetailProduct.findAll({
      where: { is_active: true, family_id: { [Op.in]: familyIds } },
      attributes: productAttrs,
      raw: true,
    });
    const byId = new Map(candidates.map((p) => [Number(p.product_id), p]));
    for (const s of siblings) {
      if (!byId.has(Number(s.product_id))) {
        byId.set(Number(s.product_id), s);
      }
    }
    allProducts = [...byId.values()];
  }

  const qLower = trimmedQ.toLowerCase();
  const scoreProduct = (p) => {
    let score = 0;
    if (exactBarcodeProductId && Number(p.product_id) === exactBarcodeProductId) score += 1_000_000;
    if (qLower && String(p.code || "").toLowerCase() === qLower) score += 900_000;
    if (words.length > 0) {
      const nameLower = String(p.name || "").toLowerCase();
      if (words.every((w) => nameLower.includes(w))) score += 10_000;
    }
    const soldTs = p.last_sold_at ? new Date(p.last_sold_at).getTime() : 0;
    const recvTs = p.last_received_at ? new Date(p.last_received_at).getTime() : 0;
    score += Math.max(soldTs, recvTs) / 1e9;
    return score;
  };

  allProducts.sort((a, b) => scoreProduct(b) - scoreProduct(a));

  const groups = groupProductsByFamily(allProducts, {
    familiesById,
    brandsById,
    categoriesById,
  }).slice(0, safeLimit);

  return {
    query: trimmedQ,
    groups,
    elapsed_ms: Date.now() - startedAt,
  };
};

export const browseFinder = async (models, { category_id, brand_id } = {}) => {
  await ensureStarterCatalog(models);

  const [categories, brands, activeProducts] = await Promise.all([
    models.RetailCategory.findAll({
      where: { is_active: true },
      order: [["sort_order", "ASC"], ["category_id", "ASC"]],
      raw: true,
    }),
    models.RetailBrand.findAll({
      where: { is_active: true },
      order: [["name", "ASC"]],
      raw: true,
    }),
    models.RetailProduct.findAll({
      where: { is_active: true },
      attributes: [
        "product_id",
        "code",
        "name",
        "name_si",
        "family_id",
        "variant_label",
        "category_id",
        "brand_id",
        "sell_price",
        "contractor_price",
        "base_unit",
        "tracking",
      ],
      raw: true,
    }),
  ]);

  const categoriesById = new Map(categories.map((c) => [Number(c.category_id), c]));
  const brandsById = new Map(brands.map((b) => [Number(b.brand_id), b]));

  const countByCat = new Map();
  for (const p of activeProducts) {
    const cid = Number(p.category_id);
    countByCat.set(cid, (countByCat.get(cid) || 0) + 1);
  }

  // Level 1: top-level categories that have items (directly or in children)
  if (!category_id) {
    const roots = categories.filter((c) => !c.parent_id);
    const result = roots
      .map((root) => {
        const children = categories.filter((c) => Number(c.parent_id) === Number(root.category_id));
        const total =
          (countByCat.get(Number(root.category_id)) || 0) +
          children.reduce((acc, ch) => acc + (countByCat.get(Number(ch.category_id)) || 0), 0);
        return { ...root, product_count: total };
      })
      .filter((r) => r.product_count > 0);
    return { level: "categories", categories: result };
  }

  const catId = Number(category_id);
  const category = categoriesById.get(catId);
  if (!category) throw new AppError("Category not found.", 404);

  const subcats = categories
    .filter((c) => Number(c.parent_id) === catId)
    .map((sc) => ({ ...sc, product_count: countByCat.get(Number(sc.category_id)) || 0 }))
    .filter((sc) => sc.product_count > 0);

  // Level 2a: sub-categories that have items
  if (!brand_id && subcats.length > 0) {
    return { level: "subcategories", category, subcategories: subcats };
  }

  const scopedCatIds = new Set([catId, ...subcats.map((s) => Number(s.category_id))]);
  const catProducts = activeProducts.filter((p) => scopedCatIds.has(Number(p.category_id)));

  // Level 2b: brands that have items in this category
  if (brand_id === undefined || brand_id === "") {
    const countByBrand = new Map();
    let unbrandedCount = 0;
    for (const p of catProducts) {
      if (p.brand_id) {
        countByBrand.set(Number(p.brand_id), (countByBrand.get(Number(p.brand_id)) || 0) + 1);
      } else {
        unbrandedCount += 1;
      }
    }
    const availableBrands = brands
      .filter((b) => (countByBrand.get(Number(b.brand_id)) || 0) > 0)
      .map((b) => ({ ...b, product_count: countByBrand.get(Number(b.brand_id)) }));

    return {
      level: "brands",
      category,
      brands: availableBrands,
      unbranded_count: unbrandedCount,
    };
  }

  // Level 3: families + variants (or stand-alone products) for category + brand
  const isUnbranded = brand_id === "none" || brand_id === "0" || brand_id === 0;
  const targetBrandId = isUnbranded ? null : Number(brand_id);
  const filteredProducts = catProducts.filter((p) =>
    isUnbranded ? !p.brand_id : Number(p.brand_id) === targetBrandId,
  );

  const families = await models.RetailFamily.findAll({ raw: true });
  const familiesById = new Map(families.map((f) => [Number(f.family_id), f]));

  return {
    level: "groups",
    category,
    brand: targetBrandId ? brandsById.get(targetBrandId) || null : null,
    groups: groupProductsByFamily(filteredProducts, {
      familiesById,
      brandsById,
      categoriesById,
    }),
  };
};
