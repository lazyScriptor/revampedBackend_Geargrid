import { Op } from "sequelize";
import { normalizePhone, splitPhones } from "../utils/whatsappPhone.js";

export { splitPhones };

/**
 * Pick the primary phone index: first valid SL mobile, falling back to first
 * valid international number. Landlines return -1 so is_primary stays false.
 */
const pickPrimaryIndex = (entries) => {
  const slMobileIdx = entries.findIndex((e) => e.valid && e.kind === "mobile");
  if (slMobileIdx !== -1) return slMobileIdx;
  return entries.findIndex((e) => e.valid);
};

/**
 * Parse a customer's free-text phone_number field into unique E.164-digit rows
 * ready to persist in CUSTOMER_PHONES.
 */
export const extractCustomerPhoneEntries = (rawPhone) => {
  const parts = splitPhones(rawPhone);
  const seen = new Set();
  const entries = [];

  for (const part of parts) {
    const parsed = normalizePhone(part);
    if (!parsed.digits || seen.has(parsed.digits)) continue;
    seen.add(parsed.digits);
    entries.push(parsed);
  }

  const primaryIdx = pickPrimaryIndex(entries);
  return entries.map((entry, idx) => ({
    phone_e164: entry.digits,
    is_primary: idx === primaryIdx,
  }));
};

/**
 * Replace a customer's CUSTOMER_PHONES rows to match their current phone_number.
 * Clears all rows when the customer is soft-deleted.
 */
export const syncCustomerPhones = async (models, customer, { transaction } = {}) => {
  if (!models?.CustomerPhone || !customer?.customer_id) return [];

  const customerId = customer.customer_id;
  await models.CustomerPhone.destroy({
    where: { customer_id: customerId },
    ...(transaction ? { transaction } : {}),
  });

  if (customer.customer_delete_status) {
    return [];
  }

  const entries = extractCustomerPhoneEntries(customer.phone_number);
  if (entries.length === 0) return [];

  const rows = entries.map((entry) => ({
    customer_id: customerId,
    phone_e164: entry.phone_e164,
    is_primary: entry.is_primary,
  }));

  await models.CustomerPhone.bulkCreate(rows, {
    ...(transaction ? { transaction } : {}),
  });

  return rows;
};

/**
 * Find matching customer IDs by raw phone input using normalized digits.
 */
export const findCustomerIdsByPhone = async (models, raw, { transaction } = {}) => {
  if (!models?.CustomerPhone) return [];

  const candidates = new Set();
  const direct = normalizePhone(raw);
  if (direct.digits) candidates.add(direct.digits);

  for (const part of splitPhones(raw)) {
    const parsed = normalizePhone(part);
    if (parsed.digits) candidates.add(parsed.digits);
  }

  const digitsList = [...candidates];
  if (digitsList.length === 0) return [];

  const where =
    digitsList.length === 1
      ? { phone_e164: digitsList[0] }
      : { phone_e164: { [Op.in]: digitsList } };

  const matches = await models.CustomerPhone.findAll({
    where,
    attributes: ["customer_id"],
    raw: true,
    ...(transaction ? { transaction } : {}),
  });

  return [...new Set((matches || []).map((row) => row.customer_id).filter(Boolean))];
};
