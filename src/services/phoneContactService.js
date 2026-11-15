import { Op } from "sequelize";
import AppError from "../utils/AppError.js";
import { normalizePhone } from "../utils/whatsappPhone.js";
import { MIN_PHONE_SEARCH_DIGITS, phoneSearchCore } from "../utils/customerPhoneSearch.js";
import { notifyEvent } from "./pushEventService.js";

const MAX_UPSERTS_PER_SYNC = 500;

/** Format stored phone_e164 ("94771234567") as Sri Lankan local form ("0771234567") for bill forms. */
export const formatPhoneLocal = (phoneE164, rawFallback = null) => {
  const digits = String(phoneE164 || "").replace(/\D/g, "");
  if (digits.startsWith("94") && digits.length === 11) {
    return `0${digits.slice(2)}`;
  }
  if (digits) return `+${digits}`;
  return rawFallback ? String(rawFallback) : "";
};

/** Split "Nimal Perera" on the first space -> { first_name: "Nimal", last_name: "Perera" }. */
export const splitDisplayName = (displayName) => {
  const trimmed = String(displayName || "").trim();
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { first_name: trimmed, last_name: "" };
  return {
    first_name: trimmed.slice(0, idx),
    last_name: trimmed.slice(idx + 1).trim(),
  };
};

/**
 * Sync phone contacts from a native device into PHONE_CONTACTS.
 * Rejects with 409 unless contact_sync_enabled is true for this device.
 */
export const syncDeviceContacts = async (
  models,
  device,
  { full = false, final = true, upserts = [], deletes = [], seen_keys } = {},
) => {
  if (!device?.contact_sync_enabled) {
    throw new AppError("Contact sync is disabled for this phone.", 409);
  }
  if (upserts.length > MAX_UPSERTS_PER_SYNC) {
    throw new AppError(`Maximum ${MAX_UPSERTS_PER_SYNC} contact upserts allowed per sync call.`, 400);
  }

  let accepted = 0;
  let skipped = 0;
  const serverNow = new Date();
  const deviceId = device.operator_device_id;

  // Normalize incoming phone numbers per contact key
  const normalizedByKey = new Map();
  const allDigits = new Set();

  for (const item of upserts) {
    const key = String(item.key || "").trim().slice(0, 64);
    const name = String(item.name || "").trim().slice(0, 255);
    if (!key || !name) {
      skipped += 1;
      continue;
    }

    const phonesForContact = new Map(); // phone_e164 -> raw_phone
    for (const raw of item.phones || []) {
      const parsed = normalizePhone(raw);
      if (!parsed.digits) {
        skipped += 1;
        continue;
      }
      if (!phonesForContact.has(parsed.digits)) {
        phonesForContact.set(parsed.digits, String(raw).trim().slice(0, 50));
        allDigits.add(parsed.digits);
      }
    }

    normalizedByKey.set(key, { name, phones: phonesForContact });
  }

  const runInTx = async (t) => {
    const opts = t ? { transaction: t } : {};

    // Look up matching customers for all normalized digits in a single query
    const customerByDigit = new Map();
    if (allDigits.size > 0 && models.CustomerPhone) {
      const phoneMatches = await models.CustomerPhone.findAll({
        where: { phone_e164: { [Op.in]: [...allDigits] } },
        attributes: ["customer_id", "phone_e164"],
        raw: true,
        ...opts,
      });
      for (const m of phoneMatches || []) {
        if (!customerByDigit.has(m.phone_e164)) {
          customerByDigit.set(m.phone_e164, m.customer_id);
        }
      }
    }

    const upsertedKeys = [...normalizedByKey.keys()];
    if (upsertedKeys.length > 0) {
      // Load existing rows for these keys so we preserve contact_id / last_used metadata
      const existingRows = await models.PhoneContact.findAll({
        where: {
          operator_device_id: deviceId,
          device_contact_key: { [Op.in]: upsertedKeys },
        },
        ...opts,
      });

      const existingMap = new Map();
      const staleIds = [];
      for (const row of existingRows || []) {
        const entry = normalizedByKey.get(row.device_contact_key);
        if (!entry || !entry.phones.has(row.phone_e164)) {
          staleIds.push(row.contact_id);
        } else {
          existingMap.set(`${row.device_contact_key}:${row.phone_e164}`, row);
        }
      }

      if (staleIds.length > 0) {
        await models.PhoneContact.destroy({
          where: { contact_id: { [Op.in]: staleIds } },
          ...opts,
        });
      }

      const toCreate = [];
      for (const [key, { name, phones }] of normalizedByKey.entries()) {
        for (const [phoneE164, rawPhone] of phones.entries()) {
          const linkedCustomerId = customerByDigit.get(phoneE164) ?? null;
          const existing = existingMap.get(`${key}:${phoneE164}`);
          if (existing) {
            await existing.update(
              {
                display_name: name,
                raw_phone: rawPhone,
                linked_customer_id: linkedCustomerId,
              },
              opts,
            );
          } else {
            toCreate.push({
              operator_device_id: deviceId,
              device_contact_key: key,
              display_name: name,
              phone_e164: phoneE164,
              raw_phone: rawPhone,
              linked_customer_id: linkedCustomerId,
            });
          }
          accepted += 1;
        }
      }

      if (toCreate.length > 0) {
        await models.PhoneContact.bulkCreate(toCreate, opts);
      }
    }

    if (deletes.length > 0) {
      await models.PhoneContact.destroy({
        where: {
          operator_device_id: deviceId,
          device_contact_key: { [Op.in]: deletes },
        },
        ...opts,
      });
    }

    // Full sync pruning on the final batch
    if (full && final !== false) {
      const keepKeys = Array.isArray(seen_keys)
        ? [...new Set([...seen_keys, ...upsertedKeys])]
        : upsertedKeys;

      if (keepKeys.length > 0) {
        await models.PhoneContact.destroy({
          where: {
            operator_device_id: deviceId,
            device_contact_key: { [Op.notIn]: keepKeys },
          },
          ...opts,
        });
      } else {
        await models.PhoneContact.destroy({
          where: { operator_device_id: deviceId },
          ...opts,
        });
      }
    }

    if (device.update) {
      await device.update({ contacts_synced_at: serverNow }, opts);
    }
  };

  if (models.sequelize?.transaction) {
    await models.sequelize.transaction(runInTx);
  } else {
    await runInTx(undefined);
  }

  return {
    accepted,
    skipped,
    server_time: serverNow.toISOString(),
  };
};

/**
 * Staff search for unlinked synced phone contacts, by phone number only (never by name).
 * Enforces at least 3 phone digits, cap 10 rows, linked_customer_id IS NULL,
 * and active contact_sync_enabled on the owning device.
 */
export const searchPhoneContacts = async (models, { search, limit = 10 } = {}) => {
  const core = phoneSearchCore(search);
  if (!core) {
    throw new AppError(
      `Search by phone number: enter at least ${MIN_PHONE_SEARCH_DIGITS} digits.`,
      400,
    );
  }

  const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 10);
  // phone_e164 is stored as digits like 94771234567, so the core digits match inside it.
  const orFilters = [{ phone_e164: { [Op.like]: `%${core}%` } }];

  const rows = await models.PhoneContact.findAll({
    where: {
      linked_customer_id: null,
      [Op.or]: orFilters,
    },
    include: models.OperatorDevice
      ? [
          {
            model: models.OperatorDevice,
            attributes: ["operator_device_id", "device_label", "contact_sync_enabled"],
            where: { contact_sync_enabled: true },
            required: true,
          },
        ]
      : [],
    order: [["display_name", "ASC"]],
    limit: safeLimit,
  });

  return {
    contacts: (rows || []).map((r) => ({
      contact_id: r.contact_id,
      operator_device_id: r.operator_device_id,
      device_label: r.OperatorDevice?.device_label ?? null,
      display_name: r.display_name,
      phone_e164: r.phone_e164,
      raw_phone: r.raw_phone ?? null,
    })),
  };
};

const sendOwnerContactUsedAlert = async (models, contact, localPhone, actorUser) => {
  try {
    const actorId = actorUser?.userId ?? actorUser?.id ?? null;
    let staffName = actorUser?.name || actorUser?.username || "";
    if (!staffName && actorId && models.User?.findByPk) {
      const user = await models.User.findByPk(actorId, {
        attributes: ["user_id", "first_name", "last_name", "username"],
      });
      staffName =
        `${user?.first_name || ""} ${user?.last_name || ""}`.trim() ||
        user?.username ||
        "Staff";
    }
    if (!staffName) staffName = "Staff";

    await notifyEvent(models, "contact_used", {
      actorUserId: actorId,
      title: "Phone contact used for a bill",
      body: `${staffName} picked "${contact.display_name}" (${localPhone}) from the phone contacts.`,
      data: { type: "contact_used", contact_id: Number(contact.contact_id) },
      category: "phone_contact",
      link: "/invoices?tab=from-contacts",
    });
  } catch {
    // Owner alerts must never fail or reject the staff action
  }
};

/**
 * Mark a phone contact as used by staff, notify non-acting administrators,
 * and return prefill values for the new customer dialog.
 */
export const usePhoneContact = async (models, contactId, actorUser) => {
  const contact = await models.PhoneContact.findByPk(contactId);
  if (!contact) {
    throw new AppError("Phone contact not found.", 404);
  }

  const actorId = actorUser?.userId ?? actorUser?.id ?? null;
  await contact.update({
    last_used_at: new Date(),
    last_used_by_user_id: actorId,
  });

  const { first_name, last_name } = splitDisplayName(contact.display_name);
  const phone_number = formatPhoneLocal(contact.phone_e164, contact.raw_phone);

  // Fire-and-forget after commit/update; never awaited in the request path
  void sendOwnerContactUsedAlert(models, contact, phone_number, actorUser);

  return {
    contact_id: contact.contact_id,
    first_name,
    last_name,
    phone_number,
  };
};
