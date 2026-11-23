import { DataTypes } from "sequelize";
import { addColumnIfMissing, tableExists } from "../lib/schemaGuards.js";

// R4: mixed bills and deleting/restoring bills with goods.
//  1. INVOICES.rental_total was backfilled once in R0 (= sub_total, before any discount) and then never
//     kept up to date, so bills made since carry 0. Set it to what the machines come to after the
//     discount: sub_total - discount_amount (a rental-only bill's whole discount falls on the rental).
//  2. INVOICE_SALE_LINES.serial_no: the serial number sold on the line, so a deleted bill can be
//     restored and the same serial taken again.
// Both steps can be run again safely.
export const up = async ({ context: qi }) => {
  const sequelize = qi.sequelize;

  if (await tableExists(qi, "INVOICES")) {
    await sequelize.query(
      `UPDATE \`INVOICES\`
          SET rental_total = GREATEST(COALESCE(sub_total, 0) - COALESCE(discount_amount, 0), 0)
        WHERE bill_kind = 'rental'
          AND COALESCE(sub_total, 0) > 0
          AND (rental_total = 0 OR (rental_total = sub_total AND COALESCE(discount_amount, 0) > 0))`,
    );
  }

  if (await tableExists(qi, "INVOICE_SALE_LINES")) {
    await addColumnIfMissing(qi, "INVOICE_SALE_LINES", "serial_no", {
      type: DataTypes.STRING(80),
      allowNull: true,
    });
  }
};

export const down = async ({ context: qi }) => {
  // The rental_total re-backfill is not undone (the old values were wrong). Only the column goes.
  if (await tableExists(qi, "INVOICE_SALE_LINES")) {
    const { hasColumn } = await import("../lib/schemaGuards.js");
    if (await hasColumn(qi, "INVOICE_SALE_LINES", "serial_no")) {
      await qi.removeColumn("INVOICE_SALE_LINES", "serial_no");
    }
  }
};
