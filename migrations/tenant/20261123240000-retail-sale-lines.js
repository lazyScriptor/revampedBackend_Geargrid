import { DataTypes } from "sequelize";
import { addIndexIfMissing, tableExists } from "../lib/schemaGuards.js";

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, "INVOICE_SALE_LINES"))) {
    await qi.createTable("INVOICE_SALE_LINES", {
      sale_line_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      invoice_id: { type: DataTypes.INTEGER, allowNull: false },
      product_id: { type: DataTypes.INTEGER, allowNull: true },
      line_kind: {
        type: DataTypes.ENUM("item", "unlisted", "sundry", "service"),
        allowNull: false,
        defaultValue: "item",
      },
      scanned_barcode: { type: DataTypes.STRING(64), allowNull: true },
      sorted_at: { type: DataTypes.DATE, allowNull: true },
      sorted_by: { type: DataTypes.INTEGER, allowNull: true },
      description: { type: DataTypes.STRING(255), allowNull: false },
      warehouse_id: { type: DataTypes.INTEGER, allowNull: false },
      unit_id: { type: DataTypes.INTEGER, allowNull: true },
      unit_label: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "pcs",
      },
      unit_factor: {
        type: DataTypes.DECIMAL(14, 3),
        allowNull: false,
        defaultValue: 1,
      },
      qty: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
      base_qty: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
      unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      price_source: {
        type: DataTypes.ENUM("retail", "contractor", "trade", "manual"),
        allowNull: false,
        defaultValue: "retail",
      },
      line_discount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      bill_discount_share: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      line_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      unit_cost: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: false,
        defaultValue: 0,
      },
      cost_total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      returned_base_qty: {
        type: DataTypes.DECIMAL(14, 3),
        allowNull: false,
        defaultValue: 0,
      },
      status: {
        type: DataTypes.ENUM("sold", "partly_returned", "returned", "voided"),
        allowNull: false,
        defaultValue: "sold",
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }

  await addIndexIfMissing(qi, "INVOICE_SALE_LINES", ["invoice_id"], {
    name: "idx_invoice_sale_lines_invoice",
  });
  await addIndexIfMissing(qi, "INVOICE_SALE_LINES", ["product_id"], {
    name: "idx_invoice_sale_lines_product",
  });
  await addIndexIfMissing(qi, "INVOICE_SALE_LINES", ["line_kind", "sorted_at"], {
    name: "idx_invoice_sale_lines_kind_sorted",
  });
};

export const down = async ({ context: qi }) => {
  if (await tableExists(qi, "INVOICE_SALE_LINES")) {
    await qi.dropTable("INVOICE_SALE_LINES");
  }
};
