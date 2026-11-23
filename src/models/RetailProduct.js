import { DataTypes } from "sequelize";

export const RETAIL_TRACKING_TYPES = ["counted", "serial", "untracked", "service"];
export const RETAIL_SERIAL_CAPTURES = ["receive", "sale"];
export const RETAIL_CREATED_VIA = ["catalog", "import", "from_unlisted", "receive"];

export default (sequelize) => {
  const RetailProduct = sequelize.define(
    "RetailProduct",
    {
      product_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      code: { type: DataTypes.STRING(40), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      name_si: { type: DataTypes.STRING(255), allowNull: true },
      family_id: { type: DataTypes.INTEGER, allowNull: true },
      variant_label: { type: DataTypes.STRING(80), allowNull: true },
      category_id: { type: DataTypes.INTEGER, allowNull: false },
      brand_id: { type: DataTypes.INTEGER, allowNull: true },
      tracking: {
        type: DataTypes.ENUM(...RETAIL_TRACKING_TYPES),
        allowNull: false,
        defaultValue: "counted",
      },
      serial_capture: {
        type: DataTypes.ENUM(...RETAIL_SERIAL_CAPTURES),
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
        type: DataTypes.ENUM(...RETAIL_CREATED_VIA),
        allowNull: false,
        defaultValue: "catalog",
      },
      created_by: { type: DataTypes.INTEGER, allowNull: true },
      confirmed_by: { type: DataTypes.INTEGER, allowNull: true },
      search_text: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: "",
      },
      last_received_at: { type: DataTypes.DATE, allowNull: true },
      last_sold_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "RETAIL_PRODUCTS",
      timestamps: true,
      indexes: [
        { fields: ["category_id"], name: "idx_retail_products_category" },
        { fields: ["family_id"], name: "idx_retail_products_family" },
        { fields: ["brand_id"], name: "idx_retail_products_brand" },
        { fields: ["is_active"], name: "idx_retail_products_active" },
        { fields: ["updatedAt"], name: "idx_retail_products_updated" },
      ],
    },
  );

  return RetailProduct;
};
