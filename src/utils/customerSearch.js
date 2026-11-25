// customerSearch.js — customer and phone-contact search helpers.
//
// Search rules:
// - Customers (POS, customer list, parent picker, invoices, accounting, reports) are searched
//   by name (first, last, company, "first last"), customer ID, NIC, and phone number.
// - Phone contacts synced from a paired phone are searched by phone number only (never by name).

import { Op, col, fn, literal, where as sqlWhere } from "sequelize";

/** Fewest phone digits (after the leading 0 / 94) a search needs; fewer would match most customers. */
export const MIN_PHONE_SEARCH_DIGITS = 3;

/** Most customer ids one search may expand to, so a short term cannot pull in a whole table. */
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

/** True when the term is only a whole number (digits, optional spaces around). */
export const isWholeNumber = (term) => /^\s*\d+\s*$/.test(String(term ?? ""));

/** A WHERE fragment matching `column` with its formatting characters stripped. */
const phoneColumnMatches = (column, core) =>
  sqlWhere(
    PHONE_FORMATTING.reduce((expr, ch) => fn("REPLACE", expr, ch, ""), col(column)),
    { [Op.like]: `%${core}%` },
  );

const sqlQuote = (value) =>
  `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

const phoneStripSql = (columnRef) =>
  PHONE_FORMATTING.reduce(
    (expr, ch) => `REPLACE(${expr}, ${sqlQuote(ch)}, '')`,
    `COALESCE(${columnRef}, '')`,
  );

/**
 * Ids of customers matching any of:
 * - exact customer_id when `term` is a whole number
 * - NIC (spaces removed, case-insensitive) when `term` has >= 5 non-space chars
 * - phone number (formatting and leading 0/94/0094 stripped) when phoneSearchCore(term) != null
 * - first_name, last_name, company_name, or "first last" when `term` has >= 2 chars
 *
 * Deleted customers are included so their historical invoices stay findable; customer lists filter
 * out deleted rows themselves. Returns [] for empty or 1-character non-numeric terms.
 */
export const findCustomerIdsBySearch = async (models, term) => {
  const trimmed = String(term ?? "").trim();
  if (!trimmed) return [];

  const orClauses = [];

  if (isWholeNumber(trimmed)) {
    const numericId = Number(trimmed);
    if (Number.isSafeInteger(numericId) && numericId > 0) {
      orClauses.push({ customer_id: numericId });
    }
  }

  const nicNorm = trimmed.replace(/\s+/g, "").toLowerCase();
  const nicStem = nicNorm.replace(/[vx]$/, "");
  if (nicStem.length >= 5) {
    if (nicNorm !== nicStem) {
      orClauses.push(
        sqlWhere(fn("LOWER", fn("REPLACE", col("nic_number"), " ", "")), {
          [Op.or]: [{ [Op.like]: `%${nicNorm}%` }, { [Op.like]: `%${nicStem}%` }],
        }),
      );
    } else {
      orClauses.push(
        sqlWhere(fn("LOWER", fn("REPLACE", col("nic_number"), " ", "")), {
          [Op.like]: `%${nicNorm}%`,
        }),
      );
    }
  }

  const core = phoneSearchCore(trimmed);
  if (core) {
    orClauses.push(phoneColumnMatches("phone_number", core));
  }

  if (trimmed.length >= 2) {
    const nameLike = `%${trimmed}%`;
    orClauses.push(
      { first_name: { [Op.like]: nameLike } },
      { last_name: { [Op.like]: nameLike } },
      { company_name: { [Op.like]: nameLike } },
      sqlWhere(
        fn(
          "CONCAT",
          fn("COALESCE", col("first_name"), ""),
          " ",
          fn("COALESCE", col("last_name"), ""),
        ),
        { [Op.like]: nameLike },
      ),
    );
  }

  if (orClauses.length === 0) return [];
  if (!models?.Customer?.findAll) return [];

  const rows = await models.Customer.findAll({
    where: { [Op.or]: orClauses },
    attributes: ["customer_id"],
    limit: MAX_MATCHED_CUSTOMERS,
    raw: true,
  });
  return rows.map((r) => r.customer_id);
};

/**
 * Sequelize ORDER clause for customer search results:
 * exact customer ID -> exact NIC -> phone matches -> name matches;
 * within each tier, most recently active first.
 */
export const customerSearchOrder = (term) => {
  const trimmed = String(term ?? "").trim();
  const whenClauses = [];

  if (isWholeNumber(trimmed)) {
    const numericId = Number(trimmed);
    if (Number.isSafeInteger(numericId) && numericId > 0) {
      whenClauses.push(`WHEN Customer.customer_id = ${numericId} THEN 0`);
    }
  }

  const nicNorm = trimmed.replace(/\s+/g, "").toLowerCase();
  if (nicNorm.length >= 5) {
    whenClauses.push(
      `WHEN LOWER(REPLACE(COALESCE(Customer.nic_number, ''), ' ', '')) = ${sqlQuote(nicNorm)} THEN 1`,
    );
  }

  const core = phoneSearchCore(trimmed);
  if (core) {
    whenClauses.push(
      `WHEN ${phoneStripSql("Customer.phone_number")} LIKE ${sqlQuote(`%${core}%`)} THEN 2`,
    );
  }

  const order = [];
  if (whenClauses.length > 0) {
    order.push([literal(`CASE ${whenClauses.join(" ")} ELSE 3 END`), "ASC"]);
  }
  order.push(["updatedAt", "DESC"], ["createdAt", "DESC"], ["customer_id", "DESC"]);
  return order;
};

/** For raw SQL `IN (:ids)`: an empty list would be invalid SQL, so it becomes an id no row has. */
export const idsForSqlIn = (ids) => (ids.length > 0 ? ids : [-1]);
