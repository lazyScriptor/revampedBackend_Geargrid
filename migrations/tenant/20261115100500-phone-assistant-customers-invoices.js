import { DataTypes } from "sequelize";
import { tableExists, addColumnIfMissing, addIndexIfMissing } from "../lib/schemaGuards.js";

export const up = async ({ context: qi }) => {
  if (await tableExists(qi, "CUSTOMERS")) {
    await addColumnIfMissing(qi, "CUSTOMERS", "source_contact_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
    await addColumnIfMissing(qi, "CUSTOMERS", "brief_changed_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
    await addIndexIfMissing(qi, "CUSTOMERS", ["brief_changed_at"], {
      name: "idx_customers_brief_changed_at",
    });
  }

  if (await tableExists(qi, "INVOICES")) {
    await addColumnIfMissing(qi, "INVOICES", "source_contact_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
    await addColumnIfMissing(qi, "INVOICES", "contact_reviewed_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
    await addColumnIfMissing(qi, "INVOICES", "contact_reviewed_by", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
    await addIndexIfMissing(qi, "INVOICES", ["source_contact_id"], {
      name: "idx_invoices_source_contact_id",
    });
  }
};

export const down = async ({ context: qi }) => {
  if (await tableExists(qi, "INVOICES")) {
    const cols = await qi.describeTable("INVOICES");
    for (const col of ["contact_reviewed_by", "contact_reviewed_at", "source_contact_id"]) {
      if (cols[col]) await qi.removeColumn("INVOICES", col);
    }
  }
  if (await tableExists(qi, "CUSTOMERS")) {
    const cols = await qi.describeTable("CUSTOMERS");
    for (const col of ["brief_changed_at", "source_contact_id"]) {
      if (cols[col]) await qi.removeColumn("CUSTOMERS", col);
    }
  }
};
