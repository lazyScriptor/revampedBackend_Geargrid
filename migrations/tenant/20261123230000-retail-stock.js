import { DataTypes } from "sequelize";
import { addIndexIfMissing, tableExists } from "../lib/schemaGuards.js";

const RETAIL_MODULE = "Retail";
const BACKDATE_PERM = [
  "retail:backdate",
  "Post stock documents dated in the past",
];

const resolveTable = async (sequelize, preferred, fallback) => {
  const [tables] = await sequelize.query("SHOW TABLES");
  const names = tables.map((t) => Object.values(t)[0]);
  return (
    names.find((t) => t === preferred) ||
    names.find((t) => t.toLowerCase() === preferred.toLowerCase()) ||
    fallback ||
    preferred
  );
};

export const up = async ({ context: qi }) => {
  const sequelize = qi.sequelize;

  // 1. RETAIL_STOCK_LEVELS (composite PK: product_id, warehouse_id)
  if (!(await tableExists(qi, "RETAIL_STOCK_LEVELS"))) {
    await qi.createTable("RETAIL_STOCK_LEVELS", {
      product_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      warehouse_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      qty_on_hand: {
        type: DataTypes.DECIMAL(14, 3),
        allowNull: false,
        defaultValue: 0,
      },
      reorder_level: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
      reorder_qty: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
      counted_at: { type: DataTypes.DATE, allowNull: true },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }
  await addIndexIfMissing(qi, "RETAIL_STOCK_LEVELS", ["updatedAt"], {
    name: "idx_retail_stock_levels_updated",
  });

  // 2. RETAIL_STOCK_DOCUMENTS
  if (!(await tableExists(qi, "RETAIL_STOCK_DOCUMENTS"))) {
    await qi.createTable("RETAIL_STOCK_DOCUMENTS", {
      doc_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      doc_type: {
        type: DataTypes.ENUM("opening", "receive", "adjust", "count", "transfer"),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("draft", "posted"),
        allowNull: false,
        defaultValue: "draft",
      },
      doc_no: { type: DataTypes.STRING(20), allowNull: false },
      warehouse_id: { type: DataTypes.INTEGER, allowNull: false },
      to_warehouse_id: { type: DataTypes.INTEGER, allowNull: true },
      supplier_name: { type: DataTypes.STRING(160), allowNull: true },
      supplier_ref: { type: DataTypes.STRING(80), allowNull: true },
      reason: { type: DataTypes.STRING(40), allowNull: true },
      note: { type: DataTypes.STRING(500), allowNull: true },
      delivery_charge: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total_cost: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      user_id: { type: DataTypes.INTEGER, allowNull: true },
      occurred_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      posted_at: { type: DataTypes.DATE, allowNull: true },
      version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
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
  await addIndexIfMissing(qi, "RETAIL_STOCK_DOCUMENTS", ["doc_type", "doc_no"], {
    unique: true,
    name: "uq_retail_stock_docs_type_no",
  });
  await addIndexIfMissing(
    qi,
    "RETAIL_STOCK_DOCUMENTS",
    ["doc_type", "status", "occurred_at"],
    { name: "idx_retail_stock_docs_type_status_date" },
  );
  await addIndexIfMissing(qi, "RETAIL_STOCK_DOCUMENTS", ["supplier_name"], {
    name: "idx_retail_stock_docs_supplier",
  });

  // 3. RETAIL_STOCK_DOCUMENT_LINES
  if (!(await tableExists(qi, "RETAIL_STOCK_DOCUMENT_LINES"))) {
    await qi.createTable("RETAIL_STOCK_DOCUMENT_LINES", {
      line_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      doc_id: { type: DataTypes.INTEGER, allowNull: false },
      product_id: { type: DataTypes.INTEGER, allowNull: false },
      unit_id: { type: DataTypes.INTEGER, allowNull: true },
      qty: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
      base_qty: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
      entered_unit_cost: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
      unit_cost: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
      counted_qty: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
      system_qty: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
      serials: { type: DataTypes.JSON, allowNull: true },
    });
  }
  await addIndexIfMissing(qi, "RETAIL_STOCK_DOCUMENT_LINES", ["doc_id"], {
    name: "idx_retail_stock_doc_lines_doc",
  });
  await addIndexIfMissing(qi, "RETAIL_STOCK_DOCUMENT_LINES", ["product_id"], {
    name: "idx_retail_stock_doc_lines_product",
  });

  // 4. RETAIL_STOCK_MOVEMENTS (insert-only ledger)
  if (!(await tableExists(qi, "RETAIL_STOCK_MOVEMENTS"))) {
    await qi.createTable("RETAIL_STOCK_MOVEMENTS", {
      movement_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      product_id: { type: DataTypes.INTEGER, allowNull: false },
      warehouse_id: { type: DataTypes.INTEGER, allowNull: false },
      qty_change: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
      qty_after: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
      type: {
        type: DataTypes.ENUM(
          "OPENING",
          "RECEIVE",
          "SALE",
          "SALE_RETURN",
          "ADJUST_IN",
          "ADJUST_OUT",
          "COUNT_IN",
          "COUNT_OUT",
          "TRANSFER_IN",
          "TRANSFER_OUT",
          "SALE_VOID",
        ),
        allowNull: false,
      },
      reason: { type: DataTypes.STRING(30), allowNull: true },
      unit_cost: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: false,
        defaultValue: 0,
      },
      doc_id: { type: DataTypes.INTEGER, allowNull: true },
      sale_line_id: { type: DataTypes.INTEGER, allowNull: true },
      user_id: { type: DataTypes.INTEGER, allowNull: true },
      occurred_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }
  await addIndexIfMissing(
    qi,
    "RETAIL_STOCK_MOVEMENTS",
    ["product_id", "warehouse_id", "occurred_at"],
    { name: "idx_retail_movements_prod_wh_date" },
  );
  await addIndexIfMissing(qi, "RETAIL_STOCK_MOVEMENTS", ["type", "occurred_at"], {
    name: "idx_retail_movements_type_date",
  });
  await addIndexIfMissing(qi, "RETAIL_STOCK_MOVEMENTS", ["sale_line_id"], {
    name: "idx_retail_movements_sale_line",
  });
  await addIndexIfMissing(qi, "RETAIL_STOCK_MOVEMENTS", ["doc_id"], {
    name: "idx_retail_movements_doc",
  });

  // 5. RETAIL_SERIALS
  if (!(await tableExists(qi, "RETAIL_SERIALS"))) {
    await qi.createTable("RETAIL_SERIALS", {
      serial_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      product_id: { type: DataTypes.INTEGER, allowNull: false },
      serial_no: { type: DataTypes.STRING(80), allowNull: false },
      warehouse_id: { type: DataTypes.INTEGER, allowNull: false },
      status: {
        type: DataTypes.ENUM("in_stock", "sold", "returned", "written_off"),
        allowNull: false,
        defaultValue: "in_stock",
      },
      receive_doc_id: { type: DataTypes.INTEGER, allowNull: true },
      sale_line_id: { type: DataTypes.INTEGER, allowNull: true },
      sold_at: { type: DataTypes.DATE, allowNull: true },
      warranty_end: { type: DataTypes.DATEONLY, allowNull: true },
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
  await addIndexIfMissing(qi, "RETAIL_SERIALS", ["product_id", "serial_no"], {
    unique: true,
    name: "uq_retail_serials_product_no",
  });
  await addIndexIfMissing(qi, "RETAIL_SERIALS", ["warehouse_id", "status"], {
    name: "idx_retail_serials_wh_status",
  });

  // 6. Permission retail:backdate -> admin roles
  const permTable = await resolveTable(sequelize, "PERMISSIONS", "permissions");
  const rolePermTable = await resolveTable(sequelize, "ROLE_PERMISSIONs", "ROLE_PERMISSIONs");
  const rolesTable = await resolveTable(sequelize, "ROLES", "roles");

  const [code, description] = BACKDATE_PERM;
  let permId;
  const [found] = await sequelize.query(
    `SELECT permission_id FROM \`${permTable}\` WHERE permission_code = ? LIMIT 1`,
    { replacements: [code] },
  );
  if (found[0]) {
    permId = found[0].permission_id;
  } else {
    const [insertId] = await sequelize.query(
      `INSERT INTO \`${permTable}\` (permission_code, module_name, description) VALUES (?, ?, ?)`,
      { replacements: [code, RETAIL_MODULE, description] },
    );
    permId = insertId;
  }

  const [admins] = await sequelize.query(
    `SELECT role_id FROM \`${rolesTable}\` WHERE hierarchy_level >= 100`,
  );
  for (const r of admins) {
    const [has] = await sequelize.query(
      `SELECT 1 FROM \`${rolePermTable}\` WHERE role_id = ? AND permission_id = ? LIMIT 1`,
      { replacements: [r.role_id, permId] },
    );
    if (!has[0]) {
      await sequelize.query(
        `INSERT INTO \`${rolePermTable}\` (role_id, permission_id) VALUES (?, ?)`,
        { replacements: [r.role_id, permId] },
      );
    }
  }
};

export const down = async ({ context: qi }) => {
  const sequelize = qi.sequelize;
  const permTable = await resolveTable(sequelize, "PERMISSIONS", "permissions");
  const rolePermTable = await resolveTable(sequelize, "ROLE_PERMISSIONs", "ROLE_PERMISSIONs");

  const [found] = await sequelize.query(
    `SELECT permission_id FROM \`${permTable}\` WHERE permission_code = ? LIMIT 1`,
    { replacements: [BACKDATE_PERM[0]] },
  );
  if (found[0]) {
    await sequelize.query(
      `DELETE FROM \`${rolePermTable}\` WHERE permission_id = ?`,
      { replacements: [found[0].permission_id] },
    );
    await sequelize.query(
      `DELETE FROM \`${permTable}\` WHERE permission_id = ?`,
      { replacements: [found[0].permission_id] },
    );
  }

  for (const table of [
    "RETAIL_SERIALS",
    "RETAIL_STOCK_MOVEMENTS",
    "RETAIL_STOCK_DOCUMENT_LINES",
    "RETAIL_STOCK_DOCUMENTS",
    "RETAIL_STOCK_LEVELS",
  ]) {
    if (await tableExists(qi, table)) {
      await qi.dropTable(table);
    }
  }
};
