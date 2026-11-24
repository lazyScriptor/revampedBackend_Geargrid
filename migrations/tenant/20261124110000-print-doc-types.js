import { ensureEnumValues, tableExists } from "../lib/schemaGuards.js";

// R6: two new kinds of print in the audit log, the short retail receipt (SALE_RECEIPT) and the slip
// for a return of sold goods (RETURN_SLIP). The column's current type is read first and the ALTER runs
// only when a value is missing, so running this again changes nothing. Existing values and the default
// (DISPATCH) are kept.
export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, "INVOICE_PRINT_LOGS"))) return;
  await ensureEnumValues(qi, "INVOICE_PRINT_LOGS", "doc_type", ["SALE_RECEIPT", "RETURN_SLIP"]);
};

// Widening an ENUM is harmless to older code, and shrinking it would fail (or lose rows) wherever the new
// kinds have been printed, so going back leaves the column as it is.
export const down = async () => {};
