import crypto from "crypto";
import path from "path";
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

  const callRow = await models.CallLog.findOne({
    where: { client_call_id: String(clientCallId || "").trim() },
  });
  if (!callRow) {
    throw new AppError("Call record not found.", 404);
  }

  const ext = path.extname(file.originalname || "") || `.${mimeType.split("/")[1] || "m4a"}`;
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 10) || ".m4a";
  const storageKey = `${tenantDbName || "tenant"}/${callRow.call_id}/${now.getTime()}${safeExt}`;
  const sha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");

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

  const existing = await models.CallRecording.findOne({
    where: { call_id: callRow.call_id },
  });

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

  return {
    recording_id: Number(recRow.recording_id),
    call_id: Number(recRow.call_id),
    mime_type: recRow.mime_type,
    bytes: Number(recRow.bytes),
    duration_seconds: recRow.duration_seconds != null ? Number(recRow.duration_seconds) : null,
    sha256: recRow.sha256,
    uploaded_at: new Date(recRow.uploaded_at).toISOString(),
    dispute_hold: Boolean(recRow.dispute_hold),
  };
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
