import fs from "node:fs";
import path from "node:path";

const STARTER_PATH = path.resolve(
  import.meta.dirname,
  "../../../../migrations/data/retail-starter-catalog.json",
);

let cachedStarterData = null;

export const loadStarterCatalogData = () => {
  if (!cachedStarterData) {
    cachedStarterData = JSON.parse(fs.readFileSync(STARTER_PATH, "utf8"));
  }
  return cachedStarterData;
};

/**
 * Lazily seed starter retail categories, sub-categories, and hardware aliases
 * when a shop has zero retail categories. Safe to call repeatedly.
 */
export const ensureStarterCatalog = async (models, { transaction } = {}) => {
  const opts = transaction ? { transaction } : {};
  const existingCount = await models.RetailCategory.count(opts);
  if (existingCount > 0) {
    return { seeded: false, categories: 0, aliases: 0 };
  }

  const starter = loadStarterCatalogData();
  let catCount = 0;

  for (let i = 0; i < (starter.categories || []).length; i++) {
    const parentDef = starter.categories[i];
    const parent = await models.RetailCategory.create(
      {
        parent_id: null,
        name: parentDef.name,
        name_si: parentDef.name_si || null,
        icon: parentDef.icon || null,
        default_unit: parentDef.default_unit || null,
        sort_order: i + 1,
        is_active: true,
      },
      opts,
    );
    catCount += 1;

    const children = parentDef.children || [];
    for (let j = 0; j < children.length; j++) {
      const childDef = children[j];
      await models.RetailCategory.create(
        {
          parent_id: parent.category_id,
          name: childDef.name,
          name_si: childDef.name_si || null,
          icon: childDef.icon || parentDef.icon || null,
          usual_sizes: childDef.usual_sizes || null,
          attributes: childDef.attributes || null,
          default_unit: childDef.default_unit || parentDef.default_unit || null,
          sort_order: j + 1,
          is_active: true,
        },
        opts,
      );
      catCount += 1;
    }
  }

  let aliasCount = 0;
  for (const aliasDef of starter.aliases || []) {
    const existingAlias = await models.RetailSearchAlias.findOne({
      where: { term: aliasDef.term.toLowerCase() },
      ...opts,
    });
    if (!existingAlias) {
      await models.RetailSearchAlias.create(
        {
          term: aliasDef.term.toLowerCase(),
          means: aliasDef.means.toLowerCase(),
        },
        opts,
      );
      aliasCount += 1;
    }
  }

  return { seeded: true, categories: catCount, aliases: aliasCount };
};
