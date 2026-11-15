import { Op } from "sequelize";
import AppError from "../utils/AppError.js";
import { normalizePhone } from "../utils/whatsappPhone.js";
import { phoneSearchCore } from "../utils/customerSearch.js";
import { loadUserCapabilitiesContext } from "./phoneAssistantPolicyService.js";
import { notifyEvent } from "./pushEventService.js";

const MAX_UPSERTS_PER_SYNC = 500;

// FUTURE (super admin setting): phone contacts are shown at the POS only after this many digits are
// typed, so staff cannot browse the shop's synced contacts with a few numbers. The shop owner wants
// it adjustable per shop from the super admin console; until then it is fixed here and in
// revampedFrontend/src/lib/phoneSearch.ts (MIN_CONTACT_SEARCH_DIGITS). See docs/FUTURE_SETTINGS.md.
export const MIN_CONTACT_SEARCH_DIGITS = 9;

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
  { full = false, final = true, confirm_empty = false, upserts = [], deletes = [], seen_keys } = {},
) => {
  const syncAllowed =
    Boolean(device?.contact_sync_enabled) ||
    (Boolean(device?.contact_sync_mode) && device.contact_sync_mode !== "off");
  if (!syncAllowed) {
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

    // Full sync pruning on the final batch (leads have operator_device_id = null so they are never affected)
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
        if (!confirm_empty && models.PhoneContact.count) {
          const existingCount = await models.PhoneContact.count({
            where: { operator_device_id: deviceId },
            ...opts,
          });
          if (existingCount > 0) {
            throw new AppError("Empty full contact sync rejected without confirm_empty.", 409);
          }
        }
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
 * Staff search for unlinked synced phone contacts and D7 leads, by phone number only (never by name).
 * Enforces MIN_CONTACT_SEARCH_DIGITS typed digits, cap 10 rows, linked_customer_id IS NULL,
 * active contact_sync_enabled on synced phone rows, and admin-or-creator visibility on leads.
 */
export const searchPhoneContacts = async (models, { search, limit = 10 } = {}, actorUser = null) => {
  const core = phoneSearchCore(search);
  const typedDigits = String(search ?? "").replace(/\D/g, "").length;
  if (!core || typedDigits < MIN_CONTACT_SEARCH_DIGITS) {
    throw new AppError(
      `Enter at least ${MIN_CONTACT_SEARCH_DIGITS} digits of the phone number to see phone contacts.`,
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
            required: false,
          },
        ]
      : [],
    order: [["display_name", "ASC"]],
    limit: safeLimit,
  });

  const actorId = actorUser?.userId ?? actorUser?.user_id ?? actorUser?.id ?? null;
  let admin = actorUser === null || actorUser === undefined || actorUser.isAdmin === true;
  if (!admin && actorId) {
    const userCtx = await loadUserCapabilitiesContext(models, actorId);
    admin = Boolean(userCtx.isAdmin);
  }

  const visibleRows = (rows || []).filter((r) => {
    const src = r.source || "phone";
    if (src === "lead") {
      return admin || (actorId != null && Number(r.created_by_user_id) === Number(actorId));
    }
    if (models.OperatorDevice) {
      if (!r.OperatorDevice) return false;
      if (r.OperatorDevice.contact_sync_enabled === false) return false;
    }
    return true;
  });

  return {
    contacts: visibleRows.slice(0, safeLimit).map((r) => {
      const item = {
        contact_id: r.contact_id,
        operator_device_id: r.operator_device_id ?? null,
        device_label: r.OperatorDevice?.device_label ?? null,
        display_name: r.display_name,
        phone_e164: r.phone_e164,
        raw_phone: r.raw_phone ?? null,
      };
      if (r.source !== undefined) item.source = r.source;
      if (r.notes !== undefined) item.notes = r.notes ?? null;
      return item;
    }),
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
 * Mark a phone contact as used by staff, verify the typed phone number matches (A-05),
 * notify non-acting administrators, and return prefill values for the new customer dialog.
 */
export const usePhoneContact = async (models, contactId, actorUser, { phone } = {}) => {
  const core = phoneSearchCore(phone);
  const typedDigits = String(phone ?? "").replace(/\D/g, "").length;
  if (!core || typedDigits < MIN_CONTACT_SEARCH_DIGITS) {
    throw new AppError(
      `A phone number with at least ${MIN_CONTACT_SEARCH_DIGITS} digits is required.`,
      400,
    );
  }

  const findOpts = models.OperatorDevice
    ? {
        include: [
          {
            model: models.OperatorDevice,
            attributes: ["operator_device_id", "contact_sync_enabled"],
            required: false,
          },
        ],
      }
    : undefined;

  const contact = findOpts
    ? await models.PhoneContact.findByPk(contactId, findOpts)
    : await models.PhoneContact.findByPk(contactId);
  if (!contact) {
    throw new AppError("Phone contact not found.", 404);
  }
  if (contact.linked_customer_id != null) {
    throw new AppError("This contact is already linked to a customer.", 409);
  }
  const source = contact.source || "phone";
  if (source === "lead") {
    const actorId = actorUser?.userId ?? actorUser?.user_id ?? actorUser?.id ?? null;
    let admin = actorUser === null || actorUser === undefined || actorUser.isAdmin === true;
    if (!admin && actorId) {
      const userCtx = await loadUserCapabilitiesContext(models, actorId);
      admin = Boolean(userCtx.isAdmin);
    }
    if (!admin && Number(contact.created_by_user_id) !== Number(actorId)) {
      throw new AppError("You do not have access to this lead.", 403);
    }
  } else if (contact.OperatorDevice && contact.OperatorDevice.contact_sync_enabled === false) {
    throw new AppError("Contact sync is disabled for the phone that owns this contact.", 409);
  }

  const storedDigits = String(contact.phone_e164 || "").replace(/\D/g, "");
  const rawCore = phoneSearchCore(contact.raw_phone || "");
  if (!storedDigits.includes(core) && rawCore !== core) {
    throw new AppError("Typed phone number does not match this contact.", 403);
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

/**
 * Delete all contacts uploaded from one paired device (privacy reset / C.5).
 */
export const deleteDeviceContacts = async (models, device) => {
  if (!device?.operator_device_id) {
    throw new AppError("Device not found.", 404);
  }
  const deleted = models.PhoneContact?.destroy
    ? await models.PhoneContact.destroy({
        where: { operator_device_id: device.operator_device_id },
      })
    : 0;
  if (device.update) {
    await device.update({ contacts_synced_at: null });
  }
  if (models.DeviceAuditLog?.create) {
    await models.DeviceAuditLog.create({
      operator_device_id: device.operator_device_id,
      actor_user_id: device.user_id ?? null,
      action: "contacts_deleted",
      detail: { deleted: Number(deleted || 0), source: "device" },
    });
  }
  return { deleted: Number(deleted || 0) };
};

/**
 * D7: Save an unknown caller as a lead (`PHONE_CONTACTS.source = 'lead'`, `operator_device_id = null`),
 * visible to administrators and the staff member who saved them.
 */
export const createLeadContact = async (
  models,
  { display_name, phone, note = null, call_id = null } = {},
  { actorUser = null, device = null } = {},
) => {
  const safeName = String(display_name || "").trim().slice(0, 255);
  if (!safeName) {
    throw new AppError("Lead name is required.", 400);
  }
  const parsed = normalizePhone(phone);
  if (!parsed.digits) {
    throw new AppError("A valid phone number is required.", 400);
  }

  if (models.CustomerPhone?.findOne) {
    const existingCustomer = await models.CustomerPhone.findOne({
      where: { phone_e164: parsed.digits },
      attributes: ["customer_id"],
    });
    if (existingCustomer?.customer_id) {
      throw new AppError("This phone number already belongs to an existing customer.", 409);
    }
  }

  const creatorUserId =
    actorUser?.userId ?? actorUser?.user_id ?? actorUser?.id ?? device?.user_id ?? null;
  const safeNote = note !== undefined && note !== null ? String(note).trim().slice(0, 500) || null : null;
  const rawPhone = String(phone || "").trim().slice(0, 50) || formatPhoneLocal(parsed.digits);

  let leadRow = models.PhoneContact?.findOne
    ? await models.PhoneContact.findOne({
        where: {
          source: "lead",
          phone_e164: parsed.digits,
          linked_customer_id: null,
        },
      })
    : null;

  if (leadRow) {
    await leadRow.update({
      display_name: safeName,
      raw_phone: rawPhone,
      notes: safeNote,
      ...(leadRow.created_by_user_id == null && creatorUserId != null
        ? { created_by_user_id: Number(creatorUserId) }
        : {}),
    });
  } else {
    leadRow = await models.PhoneContact.create({
      operator_device_id: null,
      source: "lead",
      device_contact_key: `lead:${parsed.digits}`,
      display_name: safeName,
      phone_e164: parsed.digits,
      raw_phone: rawPhone,
      notes: safeNote,
      linked_customer_id: null,
      created_by_user_id: creatorUserId !== null ? Number(creatorUserId) : null,
    });
  }

  if (models.CallLog?.update && leadRow?.contact_id) {
    try {
      await models.CallLog.update(
        { contact_id: leadRow.contact_id },
        {
          where: {
            phone_e164: parsed.digits,
            customer_id: null,
            contact_id: null,
          },
        },
      );
      if (call_id !== null && call_id !== undefined && String(call_id).trim()) {
        const numericCallId = Number(call_id);
        await models.CallLog.update(
          { contact_id: leadRow.contact_id },
          {
            where: Number.isFinite(numericCallId) && numericCallId > 0
              ? { call_id: numericCallId, customer_id: null }
              : { client_call_id: String(call_id).trim(), customer_id: null },
          },
        );
      }
    } catch {
      // Best-effort linking on call logs
    }
  }

  return {
    lead: {
      contact_id: Number(leadRow.contact_id),
      display_name: leadRow.display_name,
      phone_e164: leadRow.phone_e164,
      raw_phone: leadRow.raw_phone ?? null,
      source: "lead",
      notes: leadRow.notes ?? null,
      created_by_user_id: leadRow.created_by_user_id ?? null,
    },
  };
};
