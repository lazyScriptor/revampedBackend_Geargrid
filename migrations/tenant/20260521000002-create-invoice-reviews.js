// 20260521000002-create-invoice-reviews.js
// Adds INVOICE_REVIEWS — per-invoice staff feedback (rating + comment) so
// managers can track customer-experience signals over time. Customer.rating
// becomes a cached AVG of is_primary rows; multiple reviews per invoice are
// allowed (e.g. handover + return + followup) but only one is_primary drives
// the customer-level average.

import { DataTypes } from "sequelize";

export const up = async ({ context: queryInterface }) => {
  await queryInterface.createTable("INVOICE_REVIEWS", {
    review_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    invoice_id: { type: DataTypes.INTEGER, allowNull: false },
    // Denormalized from invoice.customer_id at insert so the customer-level
    // average query is a single-table aggregate. Keep in sync if invoices
    // ever change customer assignment (currently they don't).
    customer_id: { type: DataTypes.INTEGER, allowNull: false },
    author_user_id: { type: DataTypes.INTEGER, allowNull: false },
    stage: {
      type: DataTypes.ENUM("handover", "return", "followup", "adhoc"),
      allowNull: false,
      defaultValue: "return",
    },
    rating: { type: DataTypes.TINYINT, allowNull: true },
    comment: { type: DataTypes.TEXT, allowNull: true },
    is_primary: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    visibility: {
      type: DataTypes.ENUM("internal", "customer_visible"),
      allowNull: false,
      defaultValue: "internal",
    },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  await queryInterface.addIndex("INVOICE_REVIEWS", ["invoice_id"]);
  await queryInterface.addIndex("INVOICE_REVIEWS", ["customer_id", "createdAt"]);
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.dropTable("INVOICE_REVIEWS");
};
