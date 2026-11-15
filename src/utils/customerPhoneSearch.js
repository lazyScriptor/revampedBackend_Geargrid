// customerPhoneSearch.js — customers are searched by phone number only.
//
// Safety rule from the shop owner: a name can match the wrong person, so every customer search
// (POS, customer list, invoices, accounting, reports, phone contacts) finds people by phone number
// alone. Invoice numbers still work where a search box accepted them before.

import { Op, col, fn, where as sqlWhere } from "sequelize";

/** Fewest phone digits (after the leading 0 / 94) a search needs; fewer would match most customers. */
export const MIN_PHONE_SEARCH_DIGITS = 3;

/** Most customer ids one search may expand to, so a short number cannot pull in a whole table. */
const MAX_MATCHED_CUSTOMERS = 500;

// Characters people type inside stored phone numbers ("077 123-4567", "+94 (77) ...").
const PHONE_FORMATTING = [" ", "-", "+", "(", ")", "/", "."];

/**
 * The digits to look for, without a leading 0, 94 or 0094 so local and international forms match
 * each other. Returns null when the term has too few digits to search with (for example a name).
 */
export const phoneSearchCore = (term) => {
  const digits = String(term ?? "").replace(/\D/g, "");
  const core = digits.replace(/^(?:0094|94|0)/, "");
  return core.length >= MIN_PHONE_SEARCH_DIGITS ? core : null;
};

/** True when the term is only an invoice-style number (digits, optional spaces around). */
export const isWholeNumber = (term) => /^\s*\d+\s*$/.test(String(term ?? ""));

/** A WHERE fragment matching `column` with its formatting characters stripped. */
const phoneColumnMatches = (column, core) =>
  sqlWhere(
    PHONE_FORMATTING.reduce((expr, ch) => fn("REPLACE", expr, ch, ""), col(column)),
    { [Op.like]: `%${core}%` },
  );

/**
 * Ids of customers whose phone number contains the searched digits, deleted ones included so
 * their old invoices stay findable; customer lists drop deleted customers themselves.
 * Returns [] when the term is not a usable phone number, so callers show no results.
 */
export const findCustomerIdsByPhoneSearch = async (models, term) => {
  const core = phoneSearchCore(term);
  if (!core) return [];
  const rows = await models.Customer.findAll({
    where: { [Op.and]: [phoneColumnMatches("phone_number", core)] },
    attributes: ["customer_id"],
    limit: MAX_MATCHED_CUSTOMERS,
    raw: true,
  });
  return rows.map((r) => r.customer_id);
};

/** For raw SQL `IN (:ids)`: an empty list would be invalid SQL, so it becomes an id no row has. */
export const idsForSqlIn = (ids) => (ids.length > 0 ? ids : [-1]);
