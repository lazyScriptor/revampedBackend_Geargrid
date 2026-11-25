import { Op } from "sequelize";
import AppError from "../utils/AppError.js";
import { emitToTenant } from "../sockets/emitters.js";
import { parseJsonField } from "../utils/jsonFields.js";
import { dayInShopTz } from "../utils/rentalDays.js";
import { normalizePhone } from "../utils/whatsappPhone.js";
import { findCustomerIdsByPhone, syncCustomerPhones } from "./customerPhoneService.js";
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
import { getCollectionsSettings } from "./collectionsSettingsService.js";
import { getRecordingStorage } from "./storage/index.js";
import { recordActivity, resolveUserActivityVisibility } from "./activityService.js";
import {
  OPEN_INVOICE_STATUSES_SQL,
  PAID_PER_INVOICE_SQL,
  lineStillOutSql,
  owedExpr,
  unitsOutExpr,
} from "../utils/invoiceBalance.js";

const STALE_CALL_EVENT_MS = 2 * 60 * 1000;
const WEB_DIAL_MERGE_WINDOW_MS = 3 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_OUTCOMES = new Set(["answered", "no_answer", "unreachable"]);

export const computeSuggestedOutcome = (durationSeconds, thresholdSeconds = 5) => {
  if (durationSeconds === null || durationSeconds === undefined) return null;
  const dur = Number(durationSeconds);
  if (!Number.isFinite(dur)) return null;
  const threshold = Number.isFinite(Number(thresholdSeconds)) ? Number(thresholdSeconds) : 5;
  return dur >= threshold ? "answered" : "no_answer";
};

export const normalizeInvoiceIds = (raw) => {
  const parsed = parseJsonField(raw, raw);
  if (!Array.isArray(parsed)) return [];
  return [
    ...new Set(
      parsed
        .map((id) => parseInt(id, 10))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
};

const resolveCustomerOpenBills = async (models, customerId) => {
  if (!customerId || !models?.sequelize?.query) return [];
  try {
    const selectType = models.sequelize?.constructor?.QueryTypes?.SELECT || "SELECT";
    const rows = await models.sequelize.query(
      `SELECT
        i.invoice_id,
        ${owedExpr("i", "p.total_paid")} AS owed,
        COALESCE(la.units_out, 0) AS units_out
      FROM INVOICES i
      LEFT JOIN ${PAID_PER_INVOICE_SQL} p ON p.invoice_id = i.invoice_id
      LEFT JOIN (
        SELECT il.invoice_id, SUM(${unitsOutExpr("il")}) AS units_out
        FROM INVOICE_LINES il
        WHERE ${lineStillOutSql("il")}
        GROUP BY il.invoice_id
      ) la ON la.invoice_id = i.invoice_id
      WHERE i.customer_id = :customerId
        AND i.is_deleted = 0
        AND i.status IN ${OPEN_INVOICE_STATUSES_SQL}
      ORDER BY i.issued_date ASC, i.invoice_id ASC`,
      {
        replacements: { customerId: Number(customerId) },
        type: selectType,
      },
    );
    return (rows || [])
      .filter((r) => Number(r.owed) > 0.009 || Number(r.units_out) > 0)
      .map((r) => ({
        invoice_id: Number(r.invoice_id),
        owed: Math.max(0, Math.round(Number(r.owed || 0) * 100) / 100),
        units_out: Number(r.units_out || 0),
      }));
  } catch {
    return [];
  }
};

export const resolveCustomerOpenInvoiceIds = async (models, customerId) =>
  (await resolveCustomerOpenBills(models, customerId)).map((b) => b.invoice_id);

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
  const rawInvoiceIds = normalizeInvoiceIds(row.invoice_ids);
  return {
    note_id: Number(row.note_id),
    call_id: Number(row.call_id),
    customer_id: row.customer_id != null ? Number(row.customer_id) : null,
    contact_id: row.contact_id != null ? Number(row.contact_id) : null,
    tags: Array.isArray(rawTags) ? rawTags.map((t) => String(t)) : [],
    note: row.note ?? null,
    outcome: row.outcome ?? null,
    result: row.result ?? null,
    promise_amount:
      row.promise_amount !== null && row.promise_amount !== undefined
        ? Number(row.promise_amount)
        : null,
    promise_date: row.promise_date ? String(row.promise_date).slice(0, 10) : null,
    promise_kept_at: row.promise_kept_at
      ? new Date(row.promise_kept_at).toISOString()
      : null,
    promise_status: row.promise_status ?? null,
    invoice_ids: rawInvoiceIds,
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

const serializeCallRecord = (row, { answeredThresholdSeconds = 5 } = {}) => {
  const durationSeconds =
    row.duration_seconds !== null && row.duration_seconds !== undefined
      ? Number(row.duration_seconds)
      : null;
  const recording = row.CallRecording || null;
  return {
    call_id: Number(row.call_id),
    operator_device_id:
      row.operator_device_id !== null && row.operator_device_id !== undefined
        ? Number(row.operator_device_id)
        : null,
    source: row.source || "phone",
    user_id: row.user_id != null ? Number(row.user_id) : null,
    client_call_id: String(row.client_call_id),
    phone_e164: row.phone_e164 ?? null,
    raw_number: row.raw_number ?? null,
    direction: row.direction,
    customer_id: row.customer_id != null ? Number(row.customer_id) : null,
    contact_id: row.contact_id != null ? Number(row.contact_id) : null,
    invoice_ids: normalizeInvoiceIds(row.invoice_ids),
    started_at: new Date(row.started_at).toISOString(),
    ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    duration_seconds: durationSeconds,
    suggested_outcome: computeSuggestedOutcome(durationSeconds, answeredThresholdSeconds),
    device_label: row.OperatorDevice?.device_label ?? null,
    sim_label: row.sim_label ?? null,
    number_masked: Boolean(row.number_masked),
    callback_handled_at: row.callback_handled_at
      ? new Date(row.callback_handled_at).toISOString()
      : null,
    recording_id: recording?.recording_id != null ? Number(recording.recording_id) : null,
    dispute_hold: Boolean(recording?.dispute_hold),
    ...(Array.isArray(row.CallNotes) ? { notes: row.CallNotes.map(serializeCallNote) } : {}),
  };
};

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

  const [{ policy }, collectionsSettings] = await Promise.all([
    getPhoneAssistantPolicy(models),
    getCollectionsSettings(models).catch(() => ({ calls: { answeredThresholdSeconds: 5 } })),
  ]);
  const answeredThresholdSeconds = collectionsSettings?.calls?.answeredThresholdSeconds ?? 5;

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

  const payloadInvoiceIds = normalizeInvoiceIds(payload.invoice_ids);

  let existing = await models.CallLog.findOne({
    where: { client_call_id: clientCallId },
  });

  // Merge web-dialled call with phone's record of the same call (match by number and time window).
  if (!existing && storedPhoneE164 && payload.direction === "OUTGOING" && startedAt) {
    const windowStart = new Date(startedAt.getTime() - WEB_DIAL_MERGE_WINDOW_MS);
    const windowEnd = new Date(startedAt.getTime() + WEB_DIAL_MERGE_WINDOW_MS);
    existing = await models.CallLog.findOne({
      where: {
        phone_e164: storedPhoneE164,
        direction: "OUTGOING",
        client_call_id: { [Op.like]: "dial-%" },
        started_at: { [Op.between]: [windowStart, windowEnd] },
      },
      order: [["started_at", "DESC"]],
    }).catch(() => null);
  }

  let callRow = existing;
  const alreadyEnded = Boolean(existing?.ended_at);

  if (existing) {
    const existingInvoiceIds = normalizeInvoiceIds(existing.invoice_ids);
    let resolvedInvoiceIds =
      payloadInvoiceIds.length > 0
        ? payloadInvoiceIds
        : existingInvoiceIds.length > 0
          ? existingInvoiceIds
          : [];
    const effectiveCustomerId = customerId != null ? customerId : existing.customer_id;
    if (resolvedInvoiceIds.length === 0 && effectiveCustomerId) {
      resolvedInvoiceIds = await resolveCustomerOpenInvoiceIds(models, effectiveCustomerId);
    }

    const patch = {
      ...(existing.client_call_id !== clientCallId && String(existing.client_call_id || "").startsWith("dial-")
        ? { client_call_id: clientCallId }
        : {}),
      ...(device?.operator_device_id ? { operator_device_id: device.operator_device_id } : {}),
      ...(storedPhoneE164 && !existing.phone_e164 ? { phone_e164: storedPhoneE164 } : {}),
      ...(storedRawNumber && !existing.raw_number ? { raw_number: storedRawNumber } : {}),
      ...(simLabel && !existing.sim_label ? { sim_label: simLabel } : {}),
      ...(resolvedInvoiceIds.length > 0 ? { invoice_ids: resolvedInvoiceIds } : {}),
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
    let resolvedInvoiceIds = payloadInvoiceIds;
    if (resolvedInvoiceIds.length === 0 && customerId) {
      resolvedInvoiceIds = await resolveCustomerOpenInvoiceIds(models, customerId);
    }
    try {
      callRow = await models.CallLog.create({
        operator_device_id: device.operator_device_id,
        source: "phone",
        client_call_id: clientCallId,
        phone_e164: storedPhoneE164,
        raw_number: storedRawNumber,
        direction: payload.direction,
        customer_id: customerId,
        contact_id: contactId,
        invoice_ids: resolvedInvoiceIds.length > 0 ? resolvedInvoiceIds : null,
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
        ...(resolvedInvoiceIds.length > 0 ? { invoice_ids: resolvedInvoiceIds } : {}),
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
        // Shop default size of the desktop popup; each user can override it in their profile.
        popup_size: policy.desktop_popup?.size || "standard",
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

  const includeNewFields = Boolean(models.TenantConfig || payload.invoice_ids !== undefined);
  return {
    call_id: Number(callRow.call_id),
    client_call_id: String(callRow.client_call_id),
    customer_id: callRow.customer_id != null ? Number(callRow.customer_id) : null,
    contact_id: callRow.contact_id != null ? Number(callRow.contact_id) : null,
    ...(includeNewFields
      ? {
          invoice_ids: normalizeInvoiceIds(callRow.invoice_ids),
          suggested_outcome: computeSuggestedOutcome(
            callRow.duration_seconds,
            answeredThresholdSeconds,
          ),
        }
      : {}),
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

  const settings = await getCollectionsSettings(models).catch(() => ({
    calls: { answeredThresholdSeconds: 5 },
  }));
  const answeredThresholdSeconds = settings?.calls?.answeredThresholdSeconds ?? 5;
  const call = serializeCallRecord(row, { answeredThresholdSeconds });
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

  const settings = await getCollectionsSettings(models).catch(() => ({
    calls: { answeredThresholdSeconds: 5 },
  }));
  const answeredThresholdSeconds = settings?.calls?.answeredThresholdSeconds ?? 5;

  const calls = (rows || []).map((row) => ({
    ...serializeCallRecord(row, { answeredThresholdSeconds }),
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
 * Purge call logs older than the shop's configured retention_days (default 180)
 * and call recordings older than call_recording.retentionDays (default 90),
 * preserving any recording (and its call log) with dispute_hold = true.
 */
export const purgeExpiredCallLogs = async (
  models,
  { now = new Date(), storage = null } = {},
) => {
  const [result, collectionsSettings] = await Promise.all([
    getPhoneAssistantPolicy(models).catch(() => null),
    getCollectionsSettings(models).catch(() => null),
  ]);
  const policy = result?.policy ?? result;
  const rawDays = Number(policy?.call_logging?.retention_days ?? 180);
  const retentionDays = Number.isFinite(rawDays) && rawDays >= 1 ? Math.floor(rawDays) : 180;
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);

  const recDaysRaw = Number(collectionsSettings?.call_recording?.retentionDays ?? 90);
  const recordingRetentionDays =
    Number.isFinite(recDaysRaw) && recDaysRaw >= 1 ? Math.floor(recDaysRaw) : 90;
  const recCutoff = new Date(now.getTime() - recordingRetentionDays * DAY_MS);

  let recordingsDeleted = 0;
  let heldCallIds = [];

  if (models.CallRecording?.findAll) {
    const heldRows = await models.CallRecording.findAll({
      where: { dispute_hold: true },
      attributes: ["call_id"],
      raw: true,
    }).catch(() => []);
    heldCallIds = (heldRows || []).map((r) => Number(r.call_id)).filter((id) => id > 0);

    const expiredRecs = await models.CallRecording.findAll({
      where: {
        uploaded_at: { [Op.lt]: recCutoff },
        dispute_hold: false,
      },
    }).catch(() => []);

    if (expiredRecs && expiredRecs.length > 0) {
      const adapter = storage || getRecordingStorage();
      for (const rec of expiredRecs) {
        if (rec.storage_key && adapter?.deleteObject) {
          await adapter.deleteObject({ key: rec.storage_key }).catch(() => {});
        }
      }
      const recIds = expiredRecs.map((r) => r.recording_id);
      if (models.CallRecording?.destroy) {
        recordingsDeleted = await models.CallRecording.destroy({
          where: { recording_id: { [Op.in]: recIds } },
        });
      }
    }
  }

  const callWhere = {
    started_at: { [Op.lt]: cutoff },
    ...(heldCallIds.length > 0 ? { call_id: { [Op.notIn]: heldCallIds } } : {}),
  };

  const deleted = models.CallLog?.destroy
    ? await models.CallLog.destroy({
        where: callWhere,
      })
    : 0;

  return {
    deleted: Number(deleted || 0),
    retention_days: retentionDays,
    ...(models.CallRecording
      ? {
          recordings_deleted: Number(recordingsDeleted || 0),
          recording_retention_days: recordingRetentionDays,
        }
      : {}),
  };
};

const normalizeNotePayload = (body = {}, callRow = null) => {
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

  let outcome = null;
  if (body.outcome !== undefined && body.outcome !== null && body.outcome !== "") {
    const o = String(body.outcome).trim();
    if (!VALID_OUTCOMES.has(o)) {
      throw new AppError("Invalid call outcome. Must be answered, no_answer, or unreachable.", 400);
    }
    outcome = o;
  }

  const result =
    body.result !== undefined && body.result !== null && String(body.result).trim()
      ? String(body.result).trim().slice(0, 64)
      : null;

  if (result === "other" && !noteText) {
    throw new AppError("A note is required when result is 'other'.", 400, "note_required");
  }

  let promiseAmount = null;
  if (body.promise_amount !== undefined && body.promise_amount !== null && body.promise_amount !== "") {
    const amt = Number(body.promise_amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new AppError("promise_amount must be a positive number.", 400);
    }
    promiseAmount = Math.round(amt * 100) / 100;
  }

  let promiseDate = null;
  if (body.promise_date !== undefined && body.promise_date !== null && body.promise_date !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.promise_date))) {
      throw new AppError("promise_date must be YYYY-MM-DD.", 400);
    }
    promiseDate = String(body.promise_date);
  }

  if (result === "will_pay_on_date" && (!promiseAmount || !promiseDate)) {
    throw new AppError(
      "promise_amount and promise_date are required for 'will_pay_on_date'.",
      400,
      "promise_required",
    );
  }

  const promiseStatus = promiseAmount && promiseDate ? "waiting" : null;

  // A list sent by the caller wins, even an empty one (the cashier unticked every bill).
  const invoiceIds = Array.isArray(body.invoice_ids)
    ? normalizeInvoiceIds(body.invoice_ids)
    : normalizeInvoiceIds(callRow?.invoice_ids);

  return {
    tags,
    noteText,
    followUpOn,
    outcome,
    result,
    promiseAmount,
    promiseDate,
    promiseStatus,
    invoiceIds,
    invoiceIdsChosen: Array.isArray(body.invoice_ids),
  };
};

const persistCallNote = async (models, callRow, userId, body) => {
  if (!models.CallNote?.create) {
    throw new AppError("Call notes model unavailable.", 500);
  }
  const {
    tags,
    noteText,
    followUpOn,
    outcome,
    result,
    promiseAmount,
    promiseDate,
    promiseStatus,
    invoiceIds,
    invoiceIdsChosen,
  } = normalizeNotePayload(body, callRow);
  const created = await models.CallNote.create({
    call_id: callRow.call_id,
    customer_id: callRow.customer_id ?? null,
    contact_id: callRow.contact_id ?? null,
    tags,
    note: noteText,
    outcome,
    result,
    promise_amount: promiseAmount,
    promise_date: promiseDate,
    promise_kept_at: null,
    promise_status: promiseStatus,
    invoice_ids: invoiceIds.length > 0 ? invoiceIds : null,
    follow_up_on: followUpOn,
    follow_up_done_at: null,
    created_by_user_id: userId ?? null,
  });

  const shouldRelink = invoiceIdsChosen
    ? true
    : invoiceIds.length > 0 && normalizeInvoiceIds(callRow.invoice_ids).length === 0;
  if (shouldRelink && callRow.update) {
    await callRow.update({ invoice_ids: invoiceIds.length > 0 ? invoiceIds : null }).catch(() => {});
  }

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

const TO_NOTE_WINDOW_DAYS = 7;
const TO_NOTE_LIMIT = 50;

/**
 * M2: everything the phone's call card shows for one call made on this phone: the call with its
 * suggested outcome, the customer's open bills (ticked when the call is linked to them), the shop's
 * result chips and any note already saved.
 */
export const getDeviceCallCard = async (models, device, clientCallId) => {
  const row = await models.CallLog.findOne({
    where: {
      client_call_id: String(clientCallId || "").trim(),
      operator_device_id: device.operator_device_id,
    },
    include: [
      ...(models.Customer
        ? [{ model: models.Customer, attributes: ["customer_id", "first_name", "last_name", "company_name"], required: false }]
        : []),
      ...(models.CallNote ? [{ model: models.CallNote, required: false }] : []),
    ],
  });
  if (!row) {
    throw new AppError("Call record not found.", 404);
  }

  const [settings, userCtx, bills] = await Promise.all([
    getCollectionsSettings(models),
    loadUserCapabilitiesContext(models, device.user_id),
    resolveCustomerOpenBills(models, row.customer_id),
  ]);
  let seeAmounts = Boolean(userCtx.isAdmin);
  if (!seeAmounts) {
    const visibility = await resolveUserActivityVisibility(models, device.user_id);
    seeAmounts = visibility.seeAmounts !== false;
  }

  const threshold = settings.calls.answeredThresholdSeconds;
  const linked = normalizeInvoiceIds(row.invoice_ids);
  const notes = [...(row.CallNotes || [])].sort((a, b) => Number(b.note_id) - Number(a.note_id));
  const lastNote = notes[0] ? serializeCallNote(notes[0]) : null;
  if (lastNote && !seeAmounts) lastNote.promise_amount = null;

  const call = serializeCallRecord(row, { answeredThresholdSeconds: threshold });
  delete call.notes;

  return {
    call: { ...call, customer_name: formatCustomerName(row.Customer) },
    bills: bills.map((b) => ({
      invoice_id: b.invoice_id,
      units_out: b.units_out,
      owed: seeAmounts ? b.owed : null,
      selected: linked.length === 0 || linked.includes(b.invoice_id),
    })),
    call_results: settings.call_results.filter((r) => r.active !== false),
    answered_threshold_seconds: threshold,
    see_amounts: seeAmounts,
    note: lastNote,
  };
};

/**
 * M2: "Calls to note": this phone's recent answered or dialled calls with a customer who still owes
 * money or has machines out, and no note yet.
 */
export const listDeviceCallsToNote = async (models, device, { now = new Date() } = {}) => {
  const rows = await models.CallLog.findAll({
    where: {
      operator_device_id: device.operator_device_id,
      customer_id: { [Op.ne]: null },
      direction: { [Op.in]: ["INCOMING", "OUTGOING"] },
      ended_at: { [Op.ne]: null },
      started_at: { [Op.gte]: new Date(now.getTime() - TO_NOTE_WINDOW_DAYS * DAY_MS) },
    },
    include: [
      ...(models.Customer
        ? [{ model: models.Customer, attributes: ["customer_id", "first_name", "last_name", "company_name"], required: false }]
        : []),
      ...(models.CallNote ? [{ model: models.CallNote, attributes: ["note_id"], required: false }] : []),
    ],
    order: [
      ["started_at", "DESC"],
      ["call_id", "DESC"],
    ],
    limit: 200,
  });

  const unnoted = (rows || []).filter((r) => !(r.CallNotes || []).length);
  const openByCustomer = new Map();
  for (const customerId of new Set(unnoted.map((r) => Number(r.customer_id)))) {
    openByCustomer.set(customerId, (await resolveCustomerOpenBills(models, customerId)).length);
  }

  const settings = await getCollectionsSettings(models);
  const items = unnoted
    .filter((r) => openByCustomer.get(Number(r.customer_id)) > 0)
    .slice(0, TO_NOTE_LIMIT)
    .map((r) => {
      const call = serializeCallRecord(r, {
        answeredThresholdSeconds: settings.calls.answeredThresholdSeconds,
      });
      delete call.notes;
      return {
        ...call,
        customer_name: formatCustomerName(r.Customer),
        open_bills: openByCustomer.get(Number(r.customer_id)),
      };
    });

  return { items, total: items.length };
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
    await notifyEvent(models, "follow_up_due", {
      tenantDbName,
      vars: { customer: targetName, reason: summary, date: new Date() },
      title: `Follow-up due: ${targetName}`,
      body: summary,
      data: {
        note_id: String(note.note_id),
        ...(note.customer_id ? { customer_id: String(note.customer_id) } : {}),
        ...(note.follow_up_on ? { follow_up_on: String(note.follow_up_on).slice(0, 10) } : {}),
        type: "follow_up_due",
      },
    }).catch(() => {});
    sentCount += 1;
  }

  const promiseResult = await evaluateCallPromises(models, tenantDbName, { now }).catch(() => ({
    kept: 0,
    missed: 0,
  }));

  return {
    sent_count: sentCount,
    promises_kept: promiseResult.kept,
    promises_missed: promiseResult.missed,
  };
};

/**
 * Evaluate waiting payment promises:
 * - Kept when net payments on the customer's non-deleted bills since the promise reach promise_amount by promise_date.
 * - Missed when promise_date has passed without reaching promise_amount; records 'call_promise_missed' activity.
 */
export const evaluateCallPromises = async (models, _tenantDbName, { now = new Date() } = {}) => {
  if (!models?.CallNote?.findAll || !models?.sequelize?.query) {
    return { kept: 0, missed: 0 };
  }
  const todayStr = dayInShopTz(now);
  const waitingPromises = await models.CallNote.findAll({
    where: {
      promise_status: "waiting",
      promise_amount: { [Op.gt]: 0 },
      promise_date: { [Op.ne]: null },
      customer_id: { [Op.ne]: null },
    },
  });

  const selectType = models.sequelize?.constructor?.QueryTypes?.SELECT || "SELECT";
  let kept = 0;
  let missed = 0;

  for (const note of waitingPromises || []) {
    const promiseDate = String(note.promise_date).slice(0, 10);
    const createdAt = new Date(note.created_at || note.createdAt || now);
    const promiseAmount = Number(note.promise_amount || 0);

    const [sumRow] = await models.sequelize.query(
      `SELECT COALESCE(SUM(p.payment_amount), 0) AS total_paid
       FROM PAYMENTS p
       JOIN INVOICES i ON i.invoice_id = p.invoice_id AND i.is_deleted = 0
       WHERE i.customer_id = :customerId
         AND p.is_voided = 0
         AND p.payment_date >= :sinceDate
         AND DATE(p.payment_date) <= :untilDate`,
      {
        replacements: {
          customerId: Number(note.customer_id),
          sinceDate: createdAt,
          untilDate: promiseDate,
        },
        type: selectType,
      },
    );

    const paidSincePromise = Number(sumRow?.total_paid || 0);
    if (paidSincePromise >= promiseAmount - 0.01) {
      await note.update({
        promise_status: "kept",
        promise_kept_at: now,
      });
      if (models.Customer?.update) {
        await models.Customer.update(
          { brief_changed_at: now },
          { where: { customer_id: note.customer_id } },
        ).catch(() => {});
      }
      kept += 1;
    } else if (todayStr > promiseDate) {
      await note.update({ promise_status: "missed" });
      if (models.Customer?.update) {
        await models.Customer.update(
          { brief_changed_at: now },
          { where: { customer_id: note.customer_id } },
        ).catch(() => {});
      }
      const noteInvIds = normalizeInvoiceIds(note.invoice_ids);
      await recordActivity(
        models,
        {
          type: "call_promise_missed",
          invoice_id: noteInvIds[0] ?? null,
          customer_id: Number(note.customer_id),
          actor_user_id: note.created_by_user_id ?? null,
          amount: promiseAmount,
          data: {
            note_id: Number(note.note_id),
            call_id: Number(note.call_id),
            promise_amount: promiseAmount,
            promise_date: promiseDate,
            paid_since_promise: paidSincePromise,
            invoice_ids: noteInvIds,
          },
          occurred_at: now,
          risk: "normal",
        },
        {},
      ).catch(() => {});
      missed += 1;
    }
  }

  return { kept, missed };
};

/**
 * D4: Click-to-call from web UI — send a high-priority FCM data push `{ type: "dial", phone, invoice_ids }`
 * to the caller's own active paired phones that have capability `click_to_call`.
 * Also pre-records an outgoing CALL_LOGS row so when the phone sends its call record, both merge into one call.
 */
export const dialFromUserPhone = async (
  models,
  tenantDbName,
  userId,
  { phone, customer_id, invoice_ids } = {},
  { now = new Date() } = {},
) => {
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

  let resolvedCustomerId = customer_id ? Number(customer_id) : null;
  if (!resolvedCustomerId) {
    const identity = await resolveCallerIdentity(models, parsed.digits).catch(() => ({
      customerId: null,
    }));
    resolvedCustomerId = identity.customerId;
  }

  let resolvedInvoiceIds = normalizeInvoiceIds(invoice_ids);
  if (resolvedInvoiceIds.length === 0 && resolvedCustomerId) {
    resolvedInvoiceIds = await resolveCustomerOpenInvoiceIds(models, resolvedCustomerId);
  }

  let preCreatedCallId = null;
  if (models.CallLog?.create) {
    try {
      const dialClientId = `dial-${userId}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
      const created = await models.CallLog.create({
        operator_device_id: eligible[0].operator_device_id,
        source: "phone",
        user_id: Number(userId),
        client_call_id: dialClientId,
        phone_e164: parsed.digits,
        raw_number: formattedPhone,
        direction: "OUTGOING",
        customer_id: resolvedCustomerId,
        invoice_ids: resolvedInvoiceIds.length > 0 ? resolvedInvoiceIds : null,
        started_at: now,
      });
      preCreatedCallId = Number(created.call_id);
    } catch {
      // Best-effort pre-record; mocked tests without CallLog.create still succeed.
    }
  }

  let sent = 0;
  for (const device of eligible) {
    const result = await sendDataPush(
      device,
      {
        type: "dial",
        phone: formattedPhone,
        phone_e164: parsed.digits,
        ...(resolvedCustomerId ? { customer_id: String(resolvedCustomerId) } : {}),
        ...(resolvedInvoiceIds.length > 0
          ? { invoice_ids: JSON.stringify(resolvedInvoiceIds) }
          : {}),
      },
      { priority: "high" },
    ).catch(() => ({ sent: false }));
    if (result?.sent) sent += 1;
  }

  return {
    sent,
    total_devices: eligible.length,
    phone: formattedPhone,
    customer_id: resolvedCustomerId,
    invoice_ids: resolvedInvoiceIds,
    ...(preCreatedCallId ? { call_id: preCreatedCallId } : {}),
  };
};

/**
 * Create a manual call record (source = 'manual') and optionally its note/outcome/promise in one call.
 */
export const createManualCall = async (models, userId, body = {}, { now = new Date() } = {}) => {
  if (!userId) {
    throw new AppError("Authentication required.", 401);
  }
  if (!models?.CallLog?.create) {
    throw new AppError("CallLog model unavailable.", 500);
  }

  const customerId = body.customer_id ? Number(body.customer_id) : null;
  let rawNumber = body.phone ? String(body.phone).trim() : null;
  if (!rawNumber && customerId && models.Customer?.findByPk) {
    const cust = await models.Customer.findByPk(customerId, { attributes: ["phone_number"] }).catch(
      () => null,
    );
    rawNumber = cust?.phone_number || null;
  }
  const parsed = rawNumber ? normalizePhone(rawNumber) : { digits: "" };
  const phoneE164 = parsed.digits || null;

  let resolvedCustomerId = customerId;
  if (!resolvedCustomerId && phoneE164) {
    const identity = await resolveCallerIdentity(models, phoneE164).catch(() => ({
      customerId: null,
    }));
    resolvedCustomerId = identity.customerId;
  }

  if (!resolvedCustomerId && !rawNumber) {
    throw new AppError("customer_id or phone is required for a manual call.", 400);
  }

  const direction = ["INCOMING", "OUTGOING", "MISSED"].includes(String(body.direction || "").toUpperCase())
    ? String(body.direction).toUpperCase()
    : "OUTGOING";

  const startedAt = body.started_at ? parseIsoDate(body.started_at, "started_at") : now;
  const endedAt = body.ended_at ? parseIsoDate(body.ended_at, "ended_at") : startedAt;
  const durationSeconds =
    body.duration_seconds !== undefined && body.duration_seconds !== null
      ? Math.max(0, Math.round(Number(body.duration_seconds)))
      : body.outcome === "answered"
        ? 60
        : 0;

  let invoiceIds = normalizeInvoiceIds(body.invoice_ids);
  if (invoiceIds.length === 0 && resolvedCustomerId) {
    invoiceIds = await resolveCustomerOpenInvoiceIds(models, resolvedCustomerId);
  }

  const hasNotePayload =
    body.outcome !== undefined ||
    body.result !== undefined ||
    body.note !== undefined ||
    (Array.isArray(body.tags) && body.tags.length > 0) ||
    body.follow_up_on !== undefined ||
    body.promise_amount !== undefined ||
    body.promise_date !== undefined;

  if (hasNotePayload) {
    // Validate note/outcome/promise before creating the CallLog row so invalid input leaves no orphan call.
    normalizeNotePayload({ ...body, invoice_ids: invoiceIds }, { invoice_ids: invoiceIds });
  }

  const clientCallId = `manual-${userId}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  const callRow = await models.CallLog.create({
    operator_device_id: null,
    source: "manual",
    user_id: Number(userId),
    client_call_id: clientCallId,
    phone_e164: phoneE164,
    raw_number: rawNumber,
    direction,
    customer_id: resolvedCustomerId,
    contact_id: null,
    invoice_ids: invoiceIds.length > 0 ? invoiceIds : null,
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    number_masked: false,
  });

  let noteResult = null;
  if (hasNotePayload) {
    noteResult = await persistCallNote(models, callRow, userId, {
      ...body,
      invoice_ids: invoiceIds,
    });
  }

  const settings = await getCollectionsSettings(models).catch(() => ({
    calls: { answeredThresholdSeconds: 5 },
  }));

  return {
    call: serializeCallRecord(callRow, {
      answeredThresholdSeconds: settings?.calls?.answeredThresholdSeconds ?? 5,
    }),
    ...(noteResult ? { note: noteResult.note } : { note: null }),
  };
};

/**
 * Link an unknown-number call to an existing customer, add the number to that customer,
 * and re-link its notes and open bills.
 */
export const linkCallToCustomer = async (models, callId, { customer_id } = {}) => {
  if (!customer_id) {
    throw new AppError("customer_id is required.", 400);
  }
  const callRow = await models.CallLog.findByPk(callId);
  if (!callRow) {
    throw new AppError("Call record not found.", 404);
  }
  const customer = await models.Customer.findByPk(customer_id);
  if (!customer || customer.customer_delete_status) {
    throw new AppError("Customer not found.", 404);
  }

  const numberToAdd = callRow.raw_number || (callRow.phone_e164 ? `+${callRow.phone_e164}` : null);
  const phoneE164 = callRow.phone_e164 || (numberToAdd ? normalizePhone(numberToAdd).digits : null);

  if (phoneE164 && models.CustomerPhone?.findOne) {
    const alreadyOnCustomer = await models.CustomerPhone.findOne({
      where: { customer_id: customer.customer_id, phone_e164: phoneE164 },
    });
    if (!alreadyOnCustomer) {
      const existingText = String(customer.phone_number || "").trim();
      const displayNum = numberToAdd || phoneE164;
      const nextPhoneText = existingText ? `${existingText} / ${displayNum}` : displayNum;
      await customer.update({ phone_number: nextPhoneText });
      await syncCustomerPhones(models, customer).catch(() => {});
    }
  }

  let invoiceIds = normalizeInvoiceIds(callRow.invoice_ids);
  if (invoiceIds.length === 0) {
    invoiceIds = await resolveCustomerOpenInvoiceIds(models, customer.customer_id);
  }

  await callRow.update({
    customer_id: Number(customer.customer_id),
    contact_id: null,
    number_masked: false,
    ...(invoiceIds.length > 0 ? { invoice_ids: invoiceIds } : {}),
  });

  if (models.CallNote?.update) {
    await models.CallNote.update(
      {
        customer_id: Number(customer.customer_id),
        contact_id: null,
        ...(invoiceIds.length > 0 ? { invoice_ids: invoiceIds } : {}),
      },
      { where: { call_id: callRow.call_id } },
    ).catch(() => {});
  }

  const settings = await getCollectionsSettings(models).catch(() => ({
    calls: { answeredThresholdSeconds: 5 },
  }));

  return {
    call: serializeCallRecord(callRow, {
      answeredThresholdSeconds: settings?.calls?.answeredThresholdSeconds ?? 5,
    }),
    customer_id: Number(customer.customer_id),
  };
};
