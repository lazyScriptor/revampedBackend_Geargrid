import { Op } from "sequelize";
import AppError from "../utils/AppError.js";
import { emitToTenant } from "../sockets/emitters.js";
import { parseJsonField } from "../utils/jsonFields.js";
import { dayInShopTz } from "../utils/rentalDays.js";
import { normalizePhone } from "../utils/whatsappPhone.js";
import { findCustomerIdsByPhone } from "./customerPhoneService.js";
import { buildBriefs } from "./customerBriefService.js";
import { getTenantPlan } from "./planService.js";
import { sendDataPush } from "./devicePushService.js";
import { formatPhoneLocal } from "./phoneContactService.js";
import {
  getPhoneAssistantPolicy,
  loadUserCapabilitiesContext,
  resolveDeviceCapabilities,
} from "./phoneAssistantPolicyService.js";
import { notifyEvent } from "./pushEventService.js";

const STALE_CALL_EVENT_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const colomboHHMM = (date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = (parts.find((p) => p.type === "hour")?.value || "00").replace(/^24$/, "00");
  const minute = parts.find((p) => p.type === "minute")?.value || "00";
  return `${hour}:${minute}`;
};

const isWithinBusinessHours = (date, hours) => {
  const from = hours?.from || "08:00";
  const to = hours?.to || "18:00";
  const current = colomboHHMM(date);
  if (from <= to) return current >= from && current <= to;
  return current >= from || current <= to;
};

const maskLast4Number = (raw) => {
  const str = String(raw || "").trim();
  if (!str) return null;
  const digits = str.replace(/\D/g, "");
  const suffix = (digits || str).slice(-4);
  return `****${suffix}`;
};

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

const formatAuthorName = (author) => {
  if (!author) return null;
  const full = [author.first_name, author.last_name]
    .map((s) => (s ? String(s).trim() : ""))
    .filter(Boolean)
    .join(" ");
  return full || (author.username ? String(author.username).trim() : null);
};

const serializeCallNote = (row) => {
  const rawTags = parseJsonField(row.tags, []);
  return {
    note_id: Number(row.note_id),
    call_id: Number(row.call_id),
    customer_id: row.customer_id != null ? Number(row.customer_id) : null,
    contact_id: row.contact_id != null ? Number(row.contact_id) : null,
    tags: Array.isArray(rawTags) ? rawTags.map((t) => String(t)) : [],
    note: row.note ?? null,
    follow_up_on: row.follow_up_on ? String(row.follow_up_on).slice(0, 10) : null,
    follow_up_done_at: row.follow_up_done_at
      ? new Date(row.follow_up_done_at).toISOString()
      : null,
    created_by_user_id:
      row.created_by_user_id != null ? Number(row.created_by_user_id) : null,
    author_name: formatAuthorName(row.Author),
    created_at: new Date(row.created_at || row.createdAt || Date.now()).toISOString(),
  };
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
  sim_label: row.sim_label ?? null,
  number_masked: Boolean(row.number_masked),
  callback_handled_at: row.callback_handled_at
    ? new Date(row.callback_handled_at).toISOString()
    : null,
  ...(Array.isArray(row.CallNotes) ? { notes: row.CallNotes.map(serializeCallNote) } : {}),
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
  const simLabel = payload.sim_label ? String(payload.sim_label).trim().slice(0, 40) : null;

  const startedAt = parseIsoDate(payload.started_at, "started_at");
  const endedAt = parseIsoDate(payload.ended_at, "ended_at");
  const durationSeconds =
    payload.duration_seconds !== null && payload.duration_seconds !== undefined
      ? Math.max(0, Math.round(Number(payload.duration_seconds)))
      : null;

  const { policy } = await getPhoneAssistantPolicy(models);

  if (
    policy.call_logging?.business_hours_only &&
    !isWithinBusinessHours(startedAt, policy.call_logging.business_hours)
  ) {
    return {
      call_id: 0,
      client_call_id: clientCallId,
      customer_id: null,
      contact_id: null,
      emitted: false,
      skipped: true,
    };
  }

  if (
    device?.sim_filter &&
    device.sim_filter !== "all" &&
    simLabel &&
    simLabel !== String(device.sim_filter).trim()
  ) {
    return {
      call_id: 0,
      client_call_id: clientCallId,
      customer_id: null,
      contact_id: null,
      emitted: false,
      skipped: true,
    };
  }

  const { customerId, contactId } = await resolveCallerIdentity(models, phoneE164);

  // Apply call logging scope ("off", "customers_only", "customers_and_contacts", "all") before storing or emitting.
  const scope = device?.call_logging_scope || "customers_and_contacts";
  if (
    scope === "off" ||
    (scope === "customers_only" && !customerId) ||
    (scope === "customers_and_contacts" && !customerId && !contactId)
  ) {
    return {
      call_id: 0,
      client_call_id: clientCallId,
      customer_id: null,
      contact_id: null,
      emitted: false,
      skipped: true,
    };
  }

  let storedPhoneE164 = phoneE164;
  let storedRawNumber = rawNumber;
  let numberMasked = false;
  if (!customerId && !contactId && !policy.call_logging?.store_unknown_numbers) {
    storedPhoneE164 = null;
    storedRawNumber = maskLast4Number(rawNumber || phoneE164);
    numberMasked = true;
  }

  let existing = await models.CallLog.findOne({
    where: { client_call_id: clientCallId },
  });

  let callRow = existing;
  const alreadyEnded = Boolean(existing?.ended_at);

  if (existing) {
    const patch = {
      ...(storedPhoneE164 && !existing.phone_e164 ? { phone_e164: storedPhoneE164 } : {}),
      ...(storedRawNumber && !existing.raw_number ? { raw_number: storedRawNumber } : {}),
      ...(simLabel && !existing.sim_label ? { sim_label: simLabel } : {}),
      ...(customerId != null
        ? { customer_id: customerId, contact_id: null, number_masked: false }
        : contactId != null && existing.customer_id == null
          ? { contact_id: contactId, number_masked: false }
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
        phone_e164: storedPhoneE164,
        raw_number: storedRawNumber,
        direction: payload.direction,
        customer_id: customerId,
        contact_id: contactId,
        started_at: startedAt,
        ended_at: endedAt,
        duration_seconds: durationSeconds,
        sim_label: simLabel,
        number_masked: numberMasked,
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
        ...(simLabel && !existing.sim_label ? { sim_label: simLabel } : {}),
        ...(customerId != null ? { customer_id: customerId, contact_id: null, number_masked: false } : {}),
      };
      callRow = await existing.update(patch);
    }
  }

  // D2: Automatically mark prior unhandled missed calls for this number as handled
  // when an outgoing call or an answered incoming call completes.
  const isAnsweredOrOutgoing =
    payload.direction === "OUTGOING" ||
    (payload.direction === "INCOMING" && payload.state === "ENDED" && (durationSeconds ?? 0) > 0);
  if (isAnsweredOrOutgoing && models.CallLog?.update && (storedPhoneE164 || storedRawNumber)) {
    const clearWhere = {
      direction: "MISSED",
      callback_handled_at: null,
      ...(storedPhoneE164
        ? { phone_e164: storedPhoneE164 }
        : { raw_number: storedRawNumber }),
    };
    await models.CallLog.update(
      { callback_handled_at: endedAt || startedAt || now },
      { where: clearWhere },
    ).catch(() => {});
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
      ...(models.CallNote
        ? [
            {
              model: models.CallNote,
              required: false,
              include: models.User
                ? [
                    {
                      model: models.User,
                      as: "Author",
                      attributes: ["user_id", "first_name", "last_name", "username"],
                      required: false,
                    },
                  ]
                : [],
            },
          ]
        : []),
    ],
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
      ...(models.CallNote
        ? [
            {
              model: models.CallNote,
              required: false,
              include: models.User
                ? [
                    {
                      model: models.User,
                      as: "Author",
                      attributes: ["user_id", "first_name", "last_name", "username"],
                      required: false,
                    },
                  ]
                : [],
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

/**
 * Delete all call logs recorded from one paired device (privacy reset / C.5).
 */
export const deleteDeviceCalls = async (models, device) => {
  if (!device?.operator_device_id) {
    throw new AppError("Device not found.", 404);
  }
  const deleted = models.CallLog?.destroy
    ? await models.CallLog.destroy({
        where: { operator_device_id: device.operator_device_id },
      })
    : 0;
  if (models.DeviceAuditLog?.create) {
    await models.DeviceAuditLog.create({
      operator_device_id: device.operator_device_id,
      actor_user_id: device.user_id ?? null,
      action: "calls_deleted",
      detail: { deleted: Number(deleted || 0), source: "device" },
    });
  }
  return { deleted: Number(deleted || 0) };
};

/**
 * Purge call logs older than the shop's configured retention_days (default 180).
 */
export const purgeExpiredCallLogs = async (models, { now = new Date() } = {}) => {
  const result = await getPhoneAssistantPolicy(models).catch(() => null);
  const policy = result?.policy ?? result;
  const rawDays = Number(policy?.call_logging?.retention_days ?? 180);
  const retentionDays = Number.isFinite(rawDays) && rawDays >= 1 ? Math.floor(rawDays) : 180;
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);

  const deleted = models.CallLog?.destroy
    ? await models.CallLog.destroy({
        where: {
          started_at: { [Op.lt]: cutoff },
        },
      })
    : 0;

  return {
    deleted: Number(deleted || 0),
    retention_days: retentionDays,
  };
};

const normalizeNotePayload = (body = {}) => {
  const tags = Array.isArray(body.tags)
    ? [...new Set(body.tags.map((t) => String(t || "").trim().slice(0, 60)).filter(Boolean))].slice(
        0,
        10,
      )
    : [];
  const noteText =
    body.note !== undefined && body.note !== null ? String(body.note).trim() || null : null;
  const followUpOn =
    body.follow_up_on && /^\d{4}-\d{2}-\d{2}$/.test(String(body.follow_up_on))
      ? String(body.follow_up_on)
      : null;
  return { tags, noteText, followUpOn };
};

const persistCallNote = async (models, callRow, userId, body) => {
  if (!models.CallNote?.create) {
    throw new AppError("Call notes model unavailable.", 500);
  }
  const { tags, noteText, followUpOn } = normalizeNotePayload(body);
  const created = await models.CallNote.create({
    call_id: callRow.call_id,
    customer_id: callRow.customer_id ?? null,
    contact_id: callRow.contact_id ?? null,
    tags,
    note: noteText,
    follow_up_on: followUpOn,
    follow_up_done_at: null,
    created_by_user_id: userId ?? null,
  });

  if (callRow.customer_id && models.Customer?.update) {
    await models.Customer.update(
      { brief_changed_at: new Date() },
      { where: { customer_id: callRow.customer_id } },
    ).catch(() => {});
  }

  let hydrated = created;
  if (models.CallNote?.findByPk) {
    const reloaded = await models.CallNote.findByPk(created.note_id, {
      include: models.User
        ? [
            {
              model: models.User,
              as: "Author",
              attributes: ["user_id", "first_name", "last_name", "username"],
              required: false,
            },
          ]
        : [],
    }).catch(() => null);
    if (reloaded) hydrated = reloaded;
  }

  return { note: serializeCallNote(hydrated) };
};

/**
 * D1: Save an after-call note from a paired operator device by client_call_id.
 */
export const saveDeviceCallNote = async (models, device, clientCallId, body = {}) => {
  const callRow = await models.CallLog.findOne({
    where: { client_call_id: String(clientCallId || "").trim() },
  });
  if (!callRow) {
    throw new AppError("Call record not found.", 404);
  }
  return persistCallNote(models, callRow, device?.user_id ?? null, body);
};

/**
 * D1/D6: Save a call note from a staff web user by call_id.
 */
export const saveStaffCallNote = async (models, userId, callId, body = {}) => {
  const callRow = await models.CallLog.findByPk(callId);
  if (!callRow) {
    throw new AppError("Call record not found.", 404);
  }
  return persistCallNote(models, callRow, userId ?? null, body);
};

/**
 * D2: List unhandled missed calls, ordered most recent first, enriched with brief summaries.
 */
export const listMissedCalls = async (models, query = {}) => {
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const rows = await models.CallLog.findAll({
    where: {
      direction: "MISSED",
      callback_handled_at: null,
    },
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
      ...(models.CallNote
        ? [
            {
              model: models.CallNote,
              required: false,
              include: models.User
                ? [
                    {
                      model: models.User,
                      as: "Author",
                      attributes: ["user_id", "first_name", "last_name", "username"],
                      required: false,
                    },
                  ]
                : [],
            },
          ]
        : []),
    ],
    order: [
      ["started_at", "DESC"],
      ["call_id", "DESC"],
    ],
    limit,
  });

  const customerIds = [
    ...new Set((rows || []).map((r) => r.customer_id).filter((id) => Number.isFinite(Number(id)))),
  ];
  const briefMap = new Map();
  if (customerIds.length > 0 && models.Customer?.findAll) {
    const briefs = await buildBriefs(models, customerIds).catch(() => []);
    for (const b of briefs) {
      briefMap.set(Number(b.customer_id), b);
    }
  }

  const items = (rows || []).map((row) => ({
    ...serializeCallRecord(row),
    customer_name: formatCustomerName(row.Customer),
    contact_name: row.PhoneContact?.display_name ?? null,
    brief: row.customer_id != null ? briefMap.get(Number(row.customer_id)) ?? null : null,
  }));

  return { items };
};

/**
 * D2: Explicitly mark a missed call (and prior missed calls from the same number) as handled.
 */
export const markCallHandled = async (models, callId, { now = new Date() } = {}) => {
  const row = await models.CallLog.findByPk(callId);
  if (!row) {
    throw new AppError("Call record not found.", 404);
  }
  await row.update({ callback_handled_at: now });
  if (models.CallLog.update && (row.phone_e164 || row.raw_number)) {
    await models.CallLog.update(
      { callback_handled_at: now },
      {
        where: {
          direction: "MISSED",
          callback_handled_at: null,
          ...(row.phone_e164 ? { phone_e164: row.phone_e164 } : { raw_number: row.raw_number }),
        },
      },
    ).catch(() => {});
  }
  return {
    call_id: Number(row.call_id),
    callback_handled_at: now.toISOString(),
  };
};

const serializeFollowUpItem = (row) => ({
  ...serializeCallNote(row),
  customer_name: formatCustomerName(row.Customer),
  contact_name: row.PhoneContact?.display_name ?? null,
  phone_e164: row.CallLog?.phone_e164 ?? null,
  raw_number: row.CallLog?.raw_number ?? null,
});

/**
 * D3: List follow-up items created from call notes.
 */
export const listFollowUps = async (models, query = {}) => {
  if (!models.CallNote?.findAll) {
    return { items: [] };
  }
  const status = query.status || "pending";
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));

  const where = {
    follow_up_on: { [Op.ne]: null },
  };
  if (status === "pending") {
    where.follow_up_done_at = null;
  } else if (status === "done") {
    where.follow_up_done_at = { [Op.ne]: null };
  }
  if (query.customer_id) {
    where.customer_id = Number(query.customer_id);
  }

  const rows = await models.CallNote.findAll({
    where,
    include: [
      ...(models.CallLog
        ? [
            {
              model: models.CallLog,
              attributes: ["call_id", "phone_e164", "raw_number"],
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
      ...(models.User
        ? [
            {
              model: models.User,
              as: "Author",
              attributes: ["user_id", "first_name", "last_name", "username"],
              required: false,
            },
          ]
        : []),
    ],
    order: [
      ["follow_up_on", "ASC"],
      ["note_id", "DESC"],
    ],
    limit,
  });

  return {
    items: (rows || []).map(serializeFollowUpItem),
  };
};

/**
 * D3: Mark a follow-up item done/undone or snooze it to a future YYYY-MM-DD date.
 */
export const updateFollowUp = async (models, noteId, body = {}, { now = new Date() } = {}) => {
  if (!models.CallNote?.findByPk) {
    throw new AppError("Call notes model unavailable.", 500);
  }
  const row = await models.CallNote.findByPk(noteId, {
    include: [
      ...(models.CallLog
        ? [
            {
              model: models.CallLog,
              attributes: ["call_id", "phone_e164", "raw_number"],
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
      ...(models.User
        ? [
            {
              model: models.User,
              as: "Author",
              attributes: ["user_id", "first_name", "last_name", "username"],
              required: false,
            },
          ]
        : []),
    ],
  });
  if (!row) {
    throw new AppError("Follow-up not found.", 404);
  }

  const patch = {};
  if (typeof body.done === "boolean") {
    patch.follow_up_done_at = body.done ? now : null;
  }
  if (body.snooze_to !== undefined) {
    patch.follow_up_on = body.snooze_to;
    if (body.snooze_to !== null) {
      patch.follow_up_done_at = null;
    }
  }

  await row.update(patch);

  if (row.customer_id && models.Customer?.update) {
    await models.Customer.update(
      { brief_changed_at: now },
      { where: { customer_id: row.customer_id } },
    ).catch(() => {});
  }

  return {
    follow_up: serializeFollowUpItem(row),
  };
};

/**
 * D3: Send push notifications for due/overdue follow-up items (`follow_up_due`).
 */
export const sendDueFollowUpPushes = async (models, tenantDbName, { now = new Date() } = {}) => {
  if (!models.CallNote?.findAll) {
    return { sent_count: 0 };
  }
  const todayStr = dayInShopTz(now);
  const dueNotes = await models.CallNote.findAll({
    where: {
      follow_up_on: { [Op.lte]: todayStr },
      follow_up_done_at: null,
    },
    include: [
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
      ...(models.CallLog
        ? [
            {
              model: models.CallLog,
              attributes: ["call_id", "phone_e164", "raw_number"],
              required: false,
            },
          ]
        : []),
    ],
  });

  let sentCount = 0;
  for (const note of dueNotes || []) {
    const targetName =
      formatCustomerName(note.Customer) ||
      note.PhoneContact?.display_name ||
      note.CallLog?.raw_number ||
      note.CallLog?.phone_e164 ||
      "Customer";
    const summary = note.note || parseJsonField(note.tags, []).join(", ") || "Scheduled follow-up";
    await notifyEvent(models, tenantDbName, "follow_up_due", {
      title: `Follow-up due: ${targetName}`,
      body: summary,
      data: {
        note_id: String(note.note_id),
        ...(note.customer_id ? { customer_id: String(note.customer_id) } : {}),
        ...(note.follow_up_on ? { follow_up_on: String(note.follow_up_on).slice(0, 10) } : {}),
      },
    }).catch(() => {});
    sentCount += 1;
  }

  return { sent_count: sentCount };
};

/**
 * D4: Click-to-call from web UI — send a high-priority FCM data push `{ type: "dial", phone }`
 * to the caller's own active paired phones that have capability `click_to_call`.
 */
export const dialFromUserPhone = async (models, tenantDbName, userId, { phone } = {}) => {
  if (!userId) {
    throw new AppError("Authentication required.", 401);
  }
  const parsed = normalizePhone(phone);
  if (!parsed.digits) {
    throw new AppError("A valid phone number is required.", 400);
  }
  const formattedPhone = formatPhoneLocal(parsed.digits, phone) || String(phone).trim();

  const devices = models.OperatorDevice?.findAll
    ? await models.OperatorDevice.findAll({
        where: {
          user_id: Number(userId),
          status: "ACTIVE",
          revoked_at: null,
        },
      })
    : [];

  const [{ policy }, userCtx, plan] = await Promise.all([
    getPhoneAssistantPolicy(models),
    loadUserCapabilitiesContext(models, userId),
    tenantDbName ? getTenantPlan(tenantDbName).catch(() => null) : Promise.resolve(null),
  ]);
  const planHasPhoneAssistant = plan ? plan?.features?.phone_assistant !== false : true;
  const userActive = userCtx.user ? userCtx.user.is_active !== false : true;

  const eligible = (devices || []).filter((device) => {
    const { effective } = resolveDeviceCapabilities({
      device,
      isAdmin: userCtx.isAdmin,
      permissionSet: userCtx.permissionSet,
      policy,
      planHasPhoneAssistant,
      userActive,
    });
    return effective.click_to_call === true;
  });

  if (eligible.length === 0) {
    throw new AppError(
      "No active paired phone with click-to-call enabled was found for your account.",
      409,
      "no_click_to_call_device",
    );
  }

  let sent = 0;
  for (const device of eligible) {
    const result = await sendDataPush(
      device,
      {
        type: "dial",
        phone: formattedPhone,
        phone_e164: parsed.digits,
      },
      { priority: "high" },
    ).catch(() => ({ sent: false }));
    if (result?.sent) sent += 1;
  }

  return {
    sent,
    total_devices: eligible.length,
    phone: formattedPhone,
  };
};
