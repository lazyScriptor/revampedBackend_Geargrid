// 20260520000001-add-track-overdue-to-invoice-lines.js
// Adds track_overdue to INVOICE_LINES so individual rental items can opt out
// of late-fee accumulation. Defaults to TRUE for backward compatibility —
// existing rows keep their overdue tracking behaviour unchanged.

import { DataTypes } from "sequelize";

export const up = async ({ context: queryInterface }) => {
  await queryInterface.addColumn("INVOICE_LINES", "track_overdue", {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.removeColumn("INVOICE_LINES", "track_overdue");
};
