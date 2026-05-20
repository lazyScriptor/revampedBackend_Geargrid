// 20260521000001-add-on-behalf-customer-to-invoices.js
// Allows an invoice to be attributed to a "borrowed on behalf of" customer in
// addition to the actor (customer_id). Used when a child rents on behalf of a
// parent, or a worker rents on behalf of their company.

import { DataTypes } from "sequelize";

export const up = async ({ context: queryInterface }) => {
  await queryInterface.addColumn("INVOICES", "borrowed_on_behalf_of_customer_id", {
    type: DataTypes.INTEGER,
    allowNull: true,
  });
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.removeColumn("INVOICES", "borrowed_on_behalf_of_customer_id");
};
