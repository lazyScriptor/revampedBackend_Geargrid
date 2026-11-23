import { DataTypes } from "sequelize";
import { addIndexIfMissing, tableExists } from "../lib/schemaGuards.js";

export const up = async ({ context: qi }) => {
  // 1. RETAIL_CATEGORIES
  if (!(await tableExists(qi, "RETAIL_CATEGORIES"))) {
    await qi.createTable("RETAIL_CATEGORIES", {
      category_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      parent_id: { type: DataTypes.INTEGER, allowNull: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
      name_si: { type: DataTypes.STRING(150), allowNull: true },
      image_url: { type: DataTypes.STRING(500), allowNull: true },
      icon: { type: DataTypes.STRING(40), allowNull: true },
      usual_sizes: { type: DataTypes.JSON, allowNull: true },
      attributes: { type: DataTypes.JSON, allowNull: true },
      default_unit: { type: DataTypes.STRING(12), allowNull: true },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }
  await addIndexIfMissing(qi, "RETAIL_CATEGORIES", ["parent_id"], {
    name: "idx_retail_categories_parent",
  });
  await addIndexIfMissing(qi, "RETAIL_CATEGORIES", ["is_active"], {
    name: "idx_retail_categories_active",
  });

  // 2. RETAIL_BRANDS
  if (!(await tableExists(qi, "RETAIL_BRANDS"))) {
    await qi.createTable("RETAIL_BRANDS", {
      brand_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: { type: DataTypes.STRING(120), allowNull: false },
      logo_url: { type: DataTypes.STRING(500), allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }
  await addIndexIfMissing(qi, "RETAIL_BRANDS", ["name"], {
    unique: true,
    name: "uq_retail_brands_name",
  });

  // 3. RETAIL_FAMILIES
  if (!(await tableExists(qi, "RETAIL_FAMILIES"))) {
    await qi.createTable("RETAIL_FAMILIES", {
      family_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: { type: DataTypes.STRING(200), allowNull: false },
      name_si: { type: DataTypes.STRING(200), allowNull: true },
      category_id: { type: DataTypes.INTEGER, allowNull: false },
      brand_id: { type: DataTypes.INTEGER, allowNull: true },
      option_label: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: "Size",
      },
      option_unit: { type: DataTypes.STRING(10), allowNull: true },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }
  await addIndexIfMissing(qi, "RETAIL_FAMILIES", ["category_id"], {
    name: "idx_retail_families_category",
  });
  await addIndexIfMissing(qi, "RETAIL_FAMILIES", ["brand_id"], {
    name: "idx_retail_families_brand",
  });

  // 4. RETAIL_SEARCH_ALIASES
  if (!(await tableExists(qi, "RETAIL_SEARCH_ALIASES"))) {
    await qi.createTable("RETAIL_SEARCH_ALIASES", {
      alias_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      term: { type: DataTypes.STRING(60), allowNull: false },
      means: { type: DataTypes.STRING(60), allowNull: false },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }
  await addIndexIfMissing(qi, "RETAIL_SEARCH_ALIASES", ["term"], {
    unique: true,
    name: "uq_retail_search_aliases_term",
  });
  await addIndexIfMissing(qi, "RETAIL_SEARCH_ALIASES", ["means"], {
    name: "idx_retail_search_aliases_means",
  });

  // 5. RETAIL_PRODUCTS (No FULLTEXT index — §4.1)
  if (!(await tableExists(qi, "RETAIL_PRODUCTS"))) {
    await qi.createTable("RETAIL_PRODUCTS", {
      product_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      code: { type: DataTypes.STRING(40), allowNull: false },
      name: { type: DataTypes.STRING(255), allowNull: false },
      name_si: { type: DataTypes.STRING(255), allowNull: true },
      family_id: { type: DataTypes.INTEGER, allowNull: true },
      variant_label: { type: DataTypes.STRING(80), allowNull: true },
      category_id: { type: DataTypes.INTEGER, allowNull: false },
      brand_id: { type: DataTypes.INTEGER, allowNull: true },
      tracking: {
        type: DataTypes.ENUM("counted", "serial", "untracked", "service"),
        allowNull: false,
        defaultValue: "counted",
      },
      serial_capture: {
        type: DataTypes.ENUM("receive", "sale"),
        allowNull: true,
      },
      base_unit: {
        type: DataTypes.STRING(12),
        allowNull: false,
        defaultValue: "pcs",
      },
      allow_decimal: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      sell_price: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      contractor_price: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      trade_price: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      avg_cost: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: false,
        defaultValue: 0,
      },
      last_cost: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      reorder_level: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
      warranty_months: { type: DataTypes.INTEGER, allowNull: true },
      tax_rate_bp: { type: DataTypes.INTEGER, allowNull: true },
      image_url: { type: DataTypes.STRING(500), allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_via: {
        type: DataTypes.ENUM("catalog", "import", "from_unlisted", "receive"),
        allowNull: false,
        defaultValue: "catalog",
      },
      created_by: { type: DataTypes.INTEGER, allowNull: true },
      confirmed_by: { type: DataTypes.INTEGER, allowNull: true },
      search_text: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      last_received_at: { type: DataTypes.DATE, allowNull: true },
      last_sold_at: { type: DataTypes.DATE, allowNull: true },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }
  await addIndexIfMissing(qi, "RETAIL_PRODUCTS", ["code"], {
    unique: true,
    name: "uq_retail_products_code",
  });
  await addIndexIfMissing(qi, "RETAIL_PRODUCTS", ["category_id"], {
    name: "idx_retail_products_category",
  });
  await addIndexIfMissing(qi, "RETAIL_PRODUCTS", ["family_id"], {
    name: "idx_retail_products_family",
  });
  await addIndexIfMissing(qi, "RETAIL_PRODUCTS", ["brand_id"], {
    name: "idx_retail_products_brand",
  });
  await addIndexIfMissing(qi, "RETAIL_PRODUCTS", ["is_active"], {
    name: "idx_retail_products_active",
  });
  await addIndexIfMissing(qi, "RETAIL_PRODUCTS", ["updatedAt"], {
    name: "idx_retail_products_updated",
  });

  // 6. RETAIL_PRODUCT_UNITS
  if (!(await tableExists(qi, "RETAIL_PRODUCT_UNITS"))) {
    await qi.createTable("RETAIL_PRODUCT_UNITS", {
      unit_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      product_id: { type: DataTypes.INTEGER, allowNull: false },
      unit_name: { type: DataTypes.STRING(20), allowNull: false },
      factor: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
      sell_price: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      is_default_sale: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }
  await addIndexIfMissing(qi, "RETAIL_PRODUCT_UNITS", ["product_id", "unit_name"], {
    unique: true,
    name: "uq_retail_product_units_product_name",
  });

  // 7. RETAIL_BARCODES
  if (!(await tableExists(qi, "RETAIL_BARCODES"))) {
    await qi.createTable("RETAIL_BARCODES", {
      barcode: {
        type: DataTypes.STRING(64),
        primaryKey: true,
      },
      product_id: { type: DataTypes.INTEGER, allowNull: false },
      unit_id: { type: DataTypes.INTEGER, allowNull: true },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }
  await addIndexIfMissing(qi, "RETAIL_BARCODES", ["product_id"], {
    name: "idx_retail_barcodes_product",
  });
};

export const down = async ({ context: qi }) => {
  for (const table of [
    "RETAIL_BARCODES",
    "RETAIL_PRODUCT_UNITS",
    "RETAIL_PRODUCTS",
    "RETAIL_SEARCH_ALIASES",
    "RETAIL_FAMILIES",
    "RETAIL_BRANDS",
    "RETAIL_CATEGORIES",
  ]) {
    if (await tableExists(qi, table)) {
      await qi.dropTable(table);
    }
  }
};
