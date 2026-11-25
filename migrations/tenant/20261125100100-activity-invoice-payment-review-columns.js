import { DataTypes } from "sequelize";
import { addColumnIfMissing, tableExists } from "../lib/schemaGuards.js";

export const up = async ({ context: qi }) => {
  if (await tableExists(qi, "INVOICES")) {
    await addColumnIfMissing(qi, "INVOICES", "discount_reason_key", {
      type: DataTypes.STRING(100),
      allowNull: true,
    });
    await addColumnIfMissing(qi, "INVOICES", "discount_reason_note", {
      type: DataTypes.STRING(500),
      allowNull: true,
    });
  }

  if (await tableExists(qi, "PAYMENTS")) {
    const added = await addColumnIfMissing(qi, "PAYMENTS", "entered_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
    if (added) {
      await qi.sequelize.query(
        "UPDATE `PAYMENTS` SET `entered_at` = `payment_date` WHERE `entered_at` IS NULL",
      );
    }
  }

  if (await tableExists(qi, "INVOICE_REVIEWS")) {
    await addColumnIfMissing(qi, "INVOICE_REVIEWS", "tags", {
      type: DataTypes.JSON,
      allowNull: true,
    });
  }
};

export const down = async ({ context: qi }) => {
  // Additive migration; down is intentionally a no-op to preserve data.
};
