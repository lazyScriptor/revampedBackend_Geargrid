import crypto from "crypto";
import path from "path";
import { Op } from "sequelize";
import AppError from "../utils/AppError.js";
import { getCollectionsSettings } from "./collectionsSettingsService.js";
import { getRecordingStorage } from "./storage/index.js";

export const MAX_RECORDING_BYTES = 50 * 1024 * 1024; // 50 MB

const ALLOWED_AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/amr",
  "audio/3gpp",
  "application/ogg",
]);

export const isAllowedAudioMime = (mime) => {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  return m.startsWith("audio/") || ALLOWED_AUDIO_MIMES.has(m);
};

/** Map(operator_device_id -> ISO date of the newest recording that phone has sent). */
export const getLatestRecordingByDevice = async (models, deviceIds) => {
  const latest = new Map();
  if (deviceIds.length === 0 || !models.sequelize?.fn || !models.CallRecording?.findAll) {
    return latest;
  }
  try {
    const rows = await models.CallRecording.findAll({
      where: { device_id: { [Op.in]: deviceIds } },
      attributes: [
        "device_id",
        [models.sequelize.fn("MAX", models.sequelize.col("uploaded_at")), "last_at"],
      ],
      group: ["device_id"],
      raw: true,
    });
    for (const r of rows || []) {
      if (r.last_at) latest.set(Number(r.device_id), new Date(r.last_at).toISOString());
    }
  } catch {
    // Ignore mock SQL errors
  }
  return latest;
};

// A recording may wait for Wi-Fi, so a call counts as missing one only after this long.
const RECORDING_GRACE_MS = 24 * 60 * 60 * 1000;
// Calls older than this no longer raise the warning.
const RECORDING_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Phones that should be sending call recordings but are not (spec 9.2.8 point 4): recording is on,
 * and the phone logged an answered call after its last recording that is still without one a day later.
 * Returns Map(operator_device_id -> ISO date to show as "no recordings since").
 */
export const findPhonesMissingRecordings = async (
  models,
  devices,
  lastRecordingMap,
  { now = new Date() } = {},
) => {
  const missing = new Map();
  if (!models.CallLog?.findOne) return missing;
  const { call_recording: recording, calls } = await getCollectionsSettings(models);
  if (!recording.enabled) return missing;

  const enabledAtMs = recording.enabledAt ? new Date(recording.enabledAt).getTime() : 0;

  for (const device of devices) {
    if (!device.is_native_app || (device.status || "ACTIVE") !== "ACTIVE") continue;
    const id = Number(device.operator_device_id);
    const lastReceived = lastRecordingMap.get(id) ?? null;
    const since = new Date(
      Math.max(
        lastReceived ? new Date(lastReceived).getTime() : 0,
        enabledAtMs,
        now.getTime() - RECORDING_LOOKBACK_MS,
      ),
    );
    const until = new Date(now.getTime() - RECORDING_GRACE_MS);
    if (since >= until) continue;
    const call = await models.CallLog.findOne({
      where: {
        operator_device_id: id,
        source: "phone",
        duration_seconds: { [Op.gte]: Math.max(1, calls.answeredThresholdSeconds) },
        started_at: { [Op.gt]: since, [Op.lte]: until },
      },
      attributes: ["call_id", "started_at"],
      order: [["started_at", "ASC"]],
    });
    if (call) {
      missing.set(id, lastReceived ?? new Date(call.started_at).toISOString());
    }
  }
  return missing;
};

const toUploadResult = (recRow) => ({
  recording_id: Number(recRow.recording_id),
  call_id: Number(recRow.call_id),
  mime_type: recRow.mime_type,
  bytes: Number(recRow.bytes),
  duration_seconds: recRow.duration_seconds != null ? Number(recRow.duration_seconds) : null,
  sha256: recRow.sha256,
  uploaded_at: new Date(recRow.uploaded_at).toISOString(),
  dispute_hold: Boolean(recRow.dispute_hold),
});

export const uploadDeviceCallRecording = async (
  models,
  tenantDbName,
  device,
  clientCallId,
  file,
  body = {},
  { storage = null, now = new Date() } = {},
) => {
  const settings = await getCollectionsSettings(models);
  if (!settings?.call_recording?.enabled) {
    throw new AppError(
      "Call recording is disabled for this shop.",
      403,
      "call_recording_disabled",
    );
  }

  if (!file || !file.buffer) {
    throw new AppError("Audio recording file is required.", 400, "recording_required");
  }

  const bytes = Number(file.size ?? file.buffer.length ?? 0);
  if (bytes <= 0) {
    throw new AppError("Recording file is empty.", 400);
  }
  if (bytes > MAX_RECORDING_BYTES) {
    throw new AppError("Recording exceeds maximum size of 50 MB.", 413, "recording_too_large");
  }

  const mimeType = String(file.mimetype || "").toLowerCase().split(";")[0].trim();
  if (!isAllowedAudioMime(mimeType)) {
    throw new AppError(
      "Only audio files are accepted for call recordings.",
      400,
      "invalid_audio_type",
    );
  }

  // A phone may only attach audio to a call it logged itself; any other call is "not found".
  const callRow = await models.CallLog.findOne({
    where: {
      client_call_id: String(clientCallId || "").trim(),
      operator_device_id: device?.operator_device_id ?? 0,
    },
  });
  if (!callRow) {
    throw new AppError("Call record not found.", 404);
  }

  const sha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
  const existing = await models.CallRecording.findOne({
    where: { call_id: callRow.call_id },
  });
  // A phone retries when it never saw the answer: the same audio is not stored twice.
  if (existing && existing.sha256 === sha256) {
    return toUploadResult(existing);
  }

  const ext = path.extname(file.originalname || "") || `.${mimeType.split("/")[1] || "m4a"}`;
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 10) || ".m4a";
  const storageKey = `${tenantDbName || "tenant"}/${callRow.call_id}/${now.getTime()}${safeExt}`;

  const adapter = storage || getRecordingStorage();
  await adapter.putObject({
    key: storageKey,
    buffer: file.buffer,
    contentType: mimeType,
  });

  const durationSeconds =
    body.duration_seconds !== undefined && body.duration_seconds !== null && body.duration_seconds !== ""
      ? Math.max(0, Math.round(Number(body.duration_seconds)))
      : callRow.duration_seconds ?? null;

  // Audio under a dispute hold is never removed, even when a newer upload takes its place.
  const replacedKey = existing && !existing.dispute_hold ? existing.storage_key : null;
  let recRow;
  if (existing) {
    recRow = await existing.update({
      storage_key: storageKey,
      mime_type: mimeType,
      bytes,
      duration_seconds: durationSeconds,
      sha256,
      uploaded_at: now,
      device_id: device?.operator_device_id ?? existing.device_id ?? null,
    });
  } else {
    recRow = await models.CallRecording.create({
      call_id: callRow.call_id,
      storage_key: storageKey,
      mime_type: mimeType,
      bytes,
      duration_seconds: durationSeconds,
      sha256,
      uploaded_at: now,
      device_id: device?.operator_device_id ?? null,
      dispute_hold: false,
    });
  }

  // Retention only ever deletes the object a row points at, so a replaced one is removed here.
  if (replacedKey && replacedKey !== storageKey && adapter.deleteObject) {
    await adapter.deleteObject({ key: replacedKey }).catch((err) => {
      console.warn(`Could not delete replaced call recording ${replacedKey}: ${err.message}`);
    });
  }

  return toUploadResult(recRow);
};

export const getCallRecordingPlayback = async (
  models,
  userId,
  callId,
  { storage = null, now = new Date() } = {},
) => {
  if (!userId) {
    throw new AppError("Authentication required.", 401);
  }
  const recRow = await models.CallRecording.findOne({
    where: { call_id: Number(callId) },
  });
  if (!recRow) {
    throw new AppError("Recording not found.", 404);
  }

  if (models.CallRecordingListen?.create) {
    await models.CallRecordingListen.create({
      recording_id: Number(recRow.recording_id),
      user_id: Number(userId),
      listened_at: now,
    });
  }

  const adapter = storage || getRecordingStorage();
  if (adapter.driver === "oci") {
    const url = await adapter.getSignedUrl({
      key: recRow.storage_key,
      expiresInSeconds: 300,
      now,
    });
    return {
      mode: "signed_url",
      url,
      recording_id: Number(recRow.recording_id),
      call_id: Number(recRow.call_id),
      mime_type: recRow.mime_type,
      bytes: Number(recRow.bytes),
      duration_seconds: recRow.duration_seconds != null ? Number(recRow.duration_seconds) : null,
      dispute_hold: Boolean(recRow.dispute_hold),
    };
  }

  const stream = await adapter.getReadStream({ key: recRow.storage_key });
  return {
    mode: "stream",
    stream,
    recording_id: Number(recRow.recording_id),
    call_id: Number(recRow.call_id),
    mime_type: recRow.mime_type,
    bytes: Number(recRow.bytes),
    duration_seconds: recRow.duration_seconds != null ? Number(recRow.duration_seconds) : null,
    dispute_hold: Boolean(recRow.dispute_hold),
  };
};

export const setCallRecordingDisputeHold = async (models, callId, { dispute_hold } = {}) => {
  const recRow = await models.CallRecording.findOne({
    where: { call_id: Number(callId) },
  });
  if (!recRow) {
    throw new AppError("Recording not found.", 404);
  }
  const nextHold = Boolean(dispute_hold);
  await recRow.update({ dispute_hold: nextHold });
  return {
    recording_id: Number(recRow.recording_id),
    call_id: Number(recRow.call_id),
    dispute_hold: nextHold,
  };
};
