import { Op } from "sequelize";
import AppError from "../utils/AppError.js";
import { emitToTenant } from "../sockets/emitters.js";
import { normalizePhone } from "../utils/whatsappPhone.js";
import { findCustomerIdsByPhone } from "./customerPhoneService.js";
import { buildBriefs } from "./customerBriefService.js";

const STALE_CALL_EVENT_MS = 2 * 60 * 1000;

const parseIsoDate = (raw, fieldName) => {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(`Invalid ${fieldName} timestamp.`, 400);
  }
  return parsed;
};

const formatCustomerName = (customer) => {
  if (!customer) return null;
  const full = [customer.first_name, customer.last_name]
    .map((s) => (s ? String(s).trim() : ""))
    .filter(Boolean)
    .join(" ");
  if (full) return full;
  if (customer.company_name && String(customer.company_name).trim()) {
    return String(customer.company_name).trim();
  }
  return null;
};

const resolveCallerIdentity = async (models, phoneE164) => {
  if (!phoneE164) return { customerId: null, contactId: null };

  const customerIds = await findCustomerIdsByPhone(models, phoneE164);
  if (customerIds.length > 0) {
    if (models.Customer?.findOne) {
      const activeCustomer = await models.Customer.findOne({
        where: {
          customer_id: { [Op.in]: customerIds },
          customer_delete_status: false,
        },
        attributes: ["customer_id"],
        order: [["customer_id", "ASC"]],
      });
      if (activeCustomer) {
        return { customerId: Number(activeCustomer.customer_id), contactId: null };
      }
    } else {
      return { customerId: Number(customerIds[0]), contactId: null };
    }
  }

  if (models.PhoneContact?.findOne) {
    const contact = await models.PhoneContact.findOne({
      where: { phone_e164: phoneE164 },
      attributes: ["contact_id"],
      order: [
        ["last_used_at", "DESC"],
        ["contact_id", "ASC"],
      ],
    });
    if (contact) {
      return { customerId: null, contactId: Number(contact.contact_id) };
    }
  }

  return { customerId: null, contactId: null };
};

const serializeCallRecord = (row) => ({
  call_id: Number(row.call_id),
  operator_device_id: Number(row.operator_device_id),
  client_call_id: String(row.client_call_id),
  phone_e164: row.phone_e164 ?? null,
  raw_number: row.raw_number ?? null,
  direction: row.direction,
  customer_id: row.customer_id != null ? Number(row.customer_id) : null,
  contact_id: row.contact_id != null ? Number(row.contact_id) : null,
  started_at: new Date(row.started_at).toISOString(),
  ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
  duration_seconds:
    row.duration_seconds !== null && row.duration_seconds !== undefined
      ? Number(row.duration_seconds)
      : null,
  device_label: row.OperatorDevice?.device_label ?? null,
});

/**
 * Record an incoming/outgoing/missed call event from a paired phone.
 * Upserts on client_call_id and broadcasts Socket.IO events if fresh (<= 2 minutes).
 */
export const recordDeviceCall = async (
  models,
  tenantDbName,
  device,
  payload,
  { now = new Date() } = {},
) => {
  const clientCallId = String(payload.client_call_id || "").trim();
  if (!clientCallId) {
    throw new AppError("client_call_id is required.", 400);
  }

  const rawNumber = payload.raw_number ? String(payload.raw_number).trim() : null;
  const normalized = rawNumber ? normalizePhone(rawNumber) : { digits: "" };
  const phoneE164 = normalized.digits || null;

  const startedAt = parseIsoDate(payload.started_at, "started_at");
  const endedAt = parseIsoDate(payload.ended_at, "ended_at");
  const durationSeconds =
    payload.duration_seconds !== null && payload.duration_seconds !== undefined
      ? Math.max(0, Math.round(Number(payload.duration_seconds)))
      : null;

  const { customerId, contactId } = await resolveCallerIdentity(models, phoneE164);

  let existing = await models.CallLog.findOne({
    where: { client_call_id: clientCallId },
  });

  let callRow = existing;
  const alreadyEnded = Boolean(existing?.ended_at);

  if (existing) {
    const patch = {
      ...(phoneE164 && !existing.phone_e164 ? { phone_e164: phoneE164 } : {}),
      ...(rawNumber && !existing.raw_number ? { raw_number: rawNumber } : {}),
      ...(customerId != null
        ? { customer_id: customerId, contact_id: null }
        : contactId != null && existing.customer_id == null
          ? { contact_id: contactId }
          : {}),
    };

    if (!(alreadyEnded && payload.state === "RINGING")) {
      patch.direction = payload.direction;
      if (endedAt) patch.ended_at = endedAt;
      if (durationSeconds !== null) patch.duration_seconds = durationSeconds;
    }

    callRow = await existing.update(patch);
  } else {
    try {
      callRow = await models.CallLog.create({
        operator_device_id: device.operator_device_id,
        client_call_id: clientCallId,
        phone_e164: phoneE164,
        raw_number: rawNumber,
        direction: payload.direction,
        customer_id: customerId,
        contact_id: contactId,
        started_at: startedAt,
        ended_at: endedAt,
        duration_seconds: durationSeconds,
      });
    } catch (err) {
      if (err?.name !== "SequelizeUniqueConstraintError") throw err;
      existing = await models.CallLog.findOne({
        where: { client_call_id: clientCallId },
      });
      if (!existing) throw err;
      const patch = {
        direction: payload.direction,
        ...(endedAt ? { ended_at: endedAt } : {}),
        ...(durationSeconds !== null ? { duration_seconds: durationSeconds } : {}),
        ...(customerId != null ? { customer_id: customerId, contact_id: null } : {}),
      };
      callRow = await existing.update(patch);
    }
  }

  const ageMs = now.getTime() - startedAt.getTime();
  const isFresh = ageMs <= STALE_CALL_EVENT_MS;
  let emitted = false;

  if (isFresh && tenantDbName) {
    if (payload.state === "RINGING" && !alreadyEnded) {
      emitToTenant(tenantDbName, "call:incoming", {
        call_id: Number(callRow.call_id),
        started_at: new Date(callRow.started_at).toISOString(),
      });
      emitted = true;
    } else if (payload.state === "ENDED") {
      emitToTenant(tenantDbName, "call:ended", {
        call_id: Number(callRow.call_id),
        duration_seconds:
          callRow.duration_seconds !== null && callRow.duration_seconds !== undefined
            ? Number(callRow.duration_seconds)
            : null,
      });
      emitted = true;
    }
  }

  return {
    call_id: Number(callRow.call_id),
    client_call_id: String(callRow.client_call_id),
    customer_id: callRow.customer_id != null ? Number(callRow.customer_id) : null,
    contact_id: callRow.contact_id != null ? Number(callRow.contact_id) : null,
    emitted,
  };
};

/**
 * Fetch one call with resolved customer brief or contact match for the desktop popup.
 */
export const getCallById = async (models, callId) => {
  const row = await models.CallLog.findByPk(callId, {
    include: models.OperatorDevice
      ? [
          {
            model: models.OperatorDevice,
            attributes: ["operator_device_id", "device_label"],
            required: false,
          },
        ]
      : [],
  });

  if (!row) {
    throw new AppError("Call record not found.", 404);
  }

  const call = serializeCallRecord(row);
  let resolvedCustomerId = call.customer_id;

  let contactRow = null;
  if (!resolvedCustomerId && call.contact_id && models.PhoneContact?.findByPk) {
    contactRow = await models.PhoneContact.findByPk(call.contact_id, {
      include: models.OperatorDevice
        ? [
            {
              model: models.OperatorDevice,
              attributes: ["device_label"],
              required: false,
            },
          ]
        : [],
    });
    if (contactRow?.linked_customer_id) {
      resolvedCustomerId = Number(contactRow.linked_customer_id);
    }
  }

  if (resolvedCustomerId) {
    const briefs = await buildBriefs(models, [resolvedCustomerId]);
    if (briefs.length > 0) {
      return {
        call,
        match: "customer",
        brief: briefs[0],
        contact: null,
      };
    }
  }

  if (!contactRow && call.phone_e164 && models.PhoneContact?.findOne) {
    contactRow = await models.PhoneContact.findOne({
      where: { phone_e164: call.phone_e164 },
      include: models.OperatorDevice
        ? [
            {
              model: models.OperatorDevice,
              attributes: ["device_label"],
              required: false,
            },
          ]
        : [],
      order: [
        ["last_used_at", "DESC"],
        ["contact_id", "ASC"],
      ],
    });
  }

  if (contactRow) {
    return {
      call,
      match: "contact",
      brief: null,
      contact: {
        contact_id: Number(contactRow.contact_id),
        display_name: contactRow.display_name,
        phone_e164: contactRow.phone_e164,
        device_label: contactRow.OperatorDevice?.device_label ?? null,
      },
    };
  }

  return {
    call,
    match: "none",
    brief: null,
    contact: null,
  };
};

/**
 * List paginated call logs, optionally filtered by customer_id.
 */
export const listCalls = async (models, query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const where = {};
  if (query.customer_id) {
    where.customer_id = Number(query.customer_id);
  }

  const { count, rows } = await models.CallLog.findAndCountAll({
    where,
    include: [
      ...(models.OperatorDevice
        ? [
            {
              model: models.OperatorDevice,
              attributes: ["operator_device_id", "device_label"],
              required: false,
            },
          ]
        : []),
      ...(models.Customer
        ? [
            {
              model: models.Customer,
              attributes: ["customer_id", "first_name", "last_name", "company_name"],
              required: false,
            },
          ]
        : []),
      ...(models.PhoneContact
        ? [
            {
              model: models.PhoneContact,
              attributes: ["contact_id", "display_name"],
              required: false,
            },
          ]
        : []),
    ],
    order: [
      ["started_at", "DESC"],
      ["call_id", "DESC"],
    ],
    limit,
    offset,
    distinct: true,
    col: "call_id",
  });

  const calls = (rows || []).map((row) => ({
    ...serializeCallRecord(row),
    customer_name: formatCustomerName(row.Customer),
    contact_name: row.PhoneContact?.display_name ?? null,
  }));

  return {
    calls,
    total: Number(count || 0),
    page,
    limit,
  };
};
