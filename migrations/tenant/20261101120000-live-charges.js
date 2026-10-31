// migrations/tenant/20261101120000-live-charges.js
//
// Charges so far for machines still out (extra days on lines with no return date, late days on
// tracked lines). They used to exist only on screen until the handover, so the invoice total, the
// balance and every report showed the 1-day price. Kept up to date by services/accrualService.js:
//  • INVOICES.accrued_charges / accrued_at
//  • INVOICE_LINES.accrued_charge / accrued_days / days_out
// Fully idempotent.

import { DataTypes } from "sequelize";

const addColumnIfMissing = async (qi, table, column, spec) => {
  const cols = await qi.describeTable(table);
  if (!cols[column]) await qi.addColumn(table, column, spec);
};

export const up = async ({ context: qi }) => {
  await addColumnIfMissing(qi, "INVOICES", "accrued_charges", { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
  await addColumnIfMissing(qi, "INVOICES", "accrued_at", { type: DataTypes.DATE, allowNull: true });
  await addColumnIfMissing(qi, "INVOICE_LINES", "accrued_charge", { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
  await addColumnIfMissing(qi, "INVOICE_LINES", "accrued_days", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  await addColumnIfMissing(qi, "INVOICE_LINES", "days_out", { type: DataTypes.INTEGER, allowNull: true });
};

export const down = async ({ context: qi }) => {
  const drop = async (table, column) => {
    const cols = await qi.describeTable(table);
    if (cols[column]) await qi.removeColumn(table, column);
  };
  await drop("INVOICE_LINES", "days_out");
  await drop("INVOICE_LINES", "accrued_days");
  await drop("INVOICE_LINES", "accrued_charge");
  await drop("INVOICES", "accrued_at");
  await drop("INVOICES", "accrued_charges");
};
