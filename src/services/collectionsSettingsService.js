import AppError from "../utils/AppError.js";
import { parseJsonField } from "../utils/jsonFields.js";

export const DEFAULT_CALL_RESULTS = [
  {
    key: "will_pay_today",
    label_en: "Will pay today",
    label_si: "අද ගෙවනවා",
    active: true,
    requires_promise: false,
    requires_date: false,
    requires_note: false,
  },
  {
    key: "will_pay_on_date",
    label_en: "Will pay on a date",
    label_si: "දිනයක ගෙවනවා",
    active: true,
    requires_promise: true,
    requires_date: true,
    requires_note: false,
  },
  {
    key: "will_return_machines",
    label_en: "Will bring machines back",
    label_si: "යන්ත්‍ර ආපසු ගෙන එනවා",
    active: true,
    requires_promise: false,
    requires_date: true,
    requires_note: false,
  },
  {
    key: "asked_more_time",
    label_en: "Asked for more time",
    label_si: "වැඩි කාලයක් ඉල්ලුවා",
    active: true,
    requires_promise: false,
    requires_date: false,
    requires_note: false,
  },
  {
    key: "disputes_amount",
    label_en: "Says amount is wrong",
    label_si: "මුදල වැරදි බව කියයි",
    active: true,
    requires_promise: false,
    requires_date: false,
    requires_note: false,
  },
  {
    key: "other",
    label_en: "Other",
    label_si: "වෙනත්",
    active: true,
    requires_promise: false,
    requires_date: false,
    requires_note: true,
  },
];

export const DEFAULT_CALLS_SETTINGS = {
  answeredThresholdSeconds: 5,
};

export const DEFAULT_CALL_RECORDING_SETTINGS = {
  enabled: false,
  retentionDays: 90,
  mobileData: false,
  deleteFromPhoneAfterUpload: false,
  termsLineEnabled: false,
  termsLine_en: "Calls with our shop may be recorded for service and record-keeping.",
  termsLine_si: "සේවාව සහ වාර්තා තබාගැනීම සඳහා අපගේ වෙළඳසැල සමඟ කරන ඇමතුම් පටිගත කළ හැක.",
};

export const DEFAULT_COLLECTIONS_SETTINGS = {
  overdueMoneyDays: 30,
};

export const mergeCollectionsSettings = (custom = {}) => {
  const parsed = parseJsonField(custom, {});
  const callsRaw = parseJsonField(parsed?.calls, {});
  const threshold = Number(callsRaw?.answeredThresholdSeconds);
  const answeredThresholdSeconds =
    Number.isFinite(threshold) && threshold >= 0 && threshold <= 300
      ? Math.floor(threshold)
      : DEFAULT_CALLS_SETTINGS.answeredThresholdSeconds;

  const rawResults = Array.isArray(parsed?.call_results) ? parsed.call_results : null;
  let callResults = DEFAULT_CALL_RESULTS.map((r) => ({ ...r }));
  if (rawResults && rawResults.length > 0) {
    const cleaned = [];
    const seen = new Set();
    for (const item of rawResults) {
      const key = String(item?.key || "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const def = DEFAULT_CALL_RESULTS.find((d) => d.key === key);
      cleaned.push({
        key,
        label_en: String(item?.label_en || def?.label_en || key).trim(),
        label_si: String(item?.label_si || def?.label_si || item?.label_en || key).trim(),
        active: item?.active !== false,
        requires_promise: Boolean(item?.requires_promise ?? def?.requires_promise),
        requires_date: Boolean(item?.requires_date ?? def?.requires_date),
        requires_note: key === "other" ? true : Boolean(item?.requires_note ?? def?.requires_note),
      });
    }
    if (!seen.has("other")) {
      cleaned.push({ ...DEFAULT_CALL_RESULTS.find((d) => d.key === "other") });
    }
    if (cleaned.length > 0) callResults = cleaned;
  }

  const recRaw = parseJsonField(parsed?.call_recording, {});
  const retentionRaw = Number(recRaw?.retentionDays);
  const retentionDays =
    Number.isFinite(retentionRaw) && retentionRaw >= 1 && retentionRaw <= 3650
      ? Math.floor(retentionRaw)
      : DEFAULT_CALL_RECORDING_SETTINGS.retentionDays;

  const callRecording = {
    enabled: Boolean(recRaw?.enabled),
    // When recording was last switched on: calls before it never count as "missing a recording".
    ...(typeof recRaw?.enabledAt === "string" ? { enabledAt: recRaw.enabledAt } : {}),
    retentionDays,
    mobileData: Boolean(recRaw?.mobileData),
    deleteFromPhoneAfterUpload: Boolean(recRaw?.deleteFromPhoneAfterUpload),
    termsLineEnabled: Boolean(recRaw?.termsLineEnabled),
    termsLine_en:
      typeof recRaw?.termsLine_en === "string" && recRaw.termsLine_en.trim()
        ? recRaw.termsLine_en.trim()
        : DEFAULT_CALL_RECORDING_SETTINGS.termsLine_en,
    termsLine_si:
      typeof recRaw?.termsLine_si === "string" && recRaw.termsLine_si.trim()
        ? recRaw.termsLine_si.trim()
        : DEFAULT_CALL_RECORDING_SETTINGS.termsLine_si,
  };

  const colRaw = parseJsonField(parsed?.collections, {});
  const overdueDaysRaw = Number(colRaw?.overdueMoneyDays);
  const overdueMoneyDays =
    Number.isFinite(overdueDaysRaw) && overdueDaysRaw >= 1 && overdueDaysRaw <= 365
      ? Math.floor(overdueDaysRaw)
      : DEFAULT_COLLECTIONS_SETTINGS.overdueMoneyDays;

  return {
    calls: { answeredThresholdSeconds },
    call_results: callResults,
    call_recording: callRecording,
    collections: { overdueMoneyDays },
  };
};

export const getCollectionsSettings = async (models) => {
  const config = models?.TenantConfig?.findOne ? await models.TenantConfig.findOne() : null;
  return mergeCollectionsSettings(config?.custom_settings);
};

export const updateCollectionsSettings = async (models, payload = {}) => {
  if (!models?.TenantConfig) {
    throw new AppError("TenantConfig model unavailable.", 500);
  }
  let config = await models.TenantConfig.findOne();
  if (!config) {
    config = await models.TenantConfig.create({ business_display_name: "My Rental Co" });
  }
  const currentCustom = parseJsonField(config.custom_settings, {});
  const current = mergeCollectionsSettings(currentCustom);

  const nextCustom = { ...currentCustom };

  if (payload.calls !== undefined) {
    const t = Number(payload.calls?.answeredThresholdSeconds);
    if (!Number.isFinite(t) || t < 0 || t > 300) {
      throw new AppError("calls.answeredThresholdSeconds must be between 0 and 300.", 400);
    }
    nextCustom.calls = {
      ...current.calls,
      answeredThresholdSeconds: Math.floor(t),
    };
  }

  if (payload.call_results !== undefined) {
    if (!Array.isArray(payload.call_results) || payload.call_results.length === 0) {
      throw new AppError("call_results must be a non-empty array.", 400);
    }
    const sanitized = [];
    const seen = new Set();
    for (const item of payload.call_results) {
      const key = String(item?.key || "").trim();
      const labelEn = String(item?.label_en || "").trim();
      const labelSi = String(item?.label_si || labelEn).trim();
      if (!key || !labelEn) {
        throw new AppError("Each call result requires key and label_en.", 400);
      }
      if (seen.has(key)) continue;
      seen.add(key);
      sanitized.push({
        key: key.slice(0, 64),
        label_en: labelEn.slice(0, 120),
        label_si: labelSi.slice(0, 120),
        active: item?.active !== false,
        requires_promise: Boolean(item?.requires_promise),
        requires_date: Boolean(item?.requires_date),
        requires_note: key === "other" ? true : Boolean(item?.requires_note),
      });
    }
    if (!seen.has("other")) {
      sanitized.push({ ...DEFAULT_CALL_RESULTS.find((d) => d.key === "other") });
    }
    nextCustom.call_results = sanitized;
  }

  if (payload.call_recording !== undefined) {
    const r = payload.call_recording || {};
    const retention =
      r.retentionDays !== undefined ? Number(r.retentionDays) : current.call_recording.retentionDays;
    if (!Number.isFinite(retention) || retention < 1 || retention > 3650) {
      throw new AppError("call_recording.retentionDays must be between 1 and 3650.", 400);
    }
    nextCustom.call_recording = {
      ...current.call_recording,
      ...(typeof r.enabled === "boolean" ? { enabled: r.enabled } : {}),
      ...(r.enabled === true && !current.call_recording.enabled
        ? { enabledAt: new Date().toISOString() }
        : {}),
      retentionDays: Math.floor(retention),
      ...(typeof r.mobileData === "boolean" ? { mobileData: r.mobileData } : {}),
      ...(typeof r.deleteFromPhoneAfterUpload === "boolean"
        ? { deleteFromPhoneAfterUpload: r.deleteFromPhoneAfterUpload }
        : {}),
      ...(typeof r.termsLineEnabled === "boolean" ? { termsLineEnabled: r.termsLineEnabled } : {}),
      ...(typeof r.termsLine_en === "string" && r.termsLine_en.trim()
        ? { termsLine_en: r.termsLine_en.trim().slice(0, 500) }
        : {}),
      ...(typeof r.termsLine_si === "string" && r.termsLine_si.trim()
        ? { termsLine_si: r.termsLine_si.trim().slice(0, 500) }
        : {}),
    };
  }

  if (payload.collections !== undefined) {
    const d = Number(payload.collections?.overdueMoneyDays);
    if (!Number.isFinite(d) || d < 1 || d > 365) {
      throw new AppError("collections.overdueMoneyDays must be between 1 and 365.", 400);
    }
    nextCustom.collections = {
      ...current.collections,
      overdueMoneyDays: Math.floor(d),
    };
  }

  await config.update({ custom_settings: nextCustom });
  return mergeCollectionsSettings(nextCustom);
};
