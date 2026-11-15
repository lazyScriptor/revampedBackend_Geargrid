import { Op } from "sequelize";
import AppError from "../utils/AppError.js";
import { parseJsonField } from "../utils/jsonFields.js";
import { isUserAdmin } from "./userService.js";
import { sendDataPush } from "./devicePushService.js";
import {
  AMOUNT_MODES,
  BRIEF_FIELD_KEY_SET,
  DEFAULT_BRIEF_PROFILES,
  LOCK_SCREEN_MODES,
  normalizeBriefProfile,
} from "../config/briefFields.js";

export const DEVICE_CAPABILITY_KEYS = [
  "signatures",
  "photos",
  "caller_brief",
  "bill_view",
  "push",
  "contact_sync",
  "call_logging",
  "click_to_call",
];

export const PHONE_ASSISTANT_CAPABILITY_KEYS = new Set([
  "caller_brief",
  "bill_view",
  "push",
  "contact_sync",
  "call_logging",
  "click_to_call",
]);

export const APPROVAL_MODES = new Set([
  "admin_approves_all",
  "auto_approve_admin_phones",
  "auto_approve_all",
]);

export const UNKNOWN_CALLER_MODES = new Set([
  "show_not_in_geargrid",
  "show_nothing",
]);

export const SHARED_NUMBER_MODES = new Set(["list_all", "first_only"]);

export const OVERLAY_POSITIONS = new Set(["top", "bottom"]);
export const OVERLAY_SHOW_FOR_MODES = new Set(["incoming", "incoming_and_outgoing"]);

export const CONTACT_SYNC_MODES = ["off", "selected_labels", "selected_accounts", "all"];
export const CONTACT_SYNC_MODE_SET = new Set(CONTACT_SYNC_MODES);

export const CALL_LOGGING_SCOPES = [
  "off",
  "customers_only",
  "customers_and_contacts",
  "all",
];
export const CALL_LOGGING_SCOPE_SET = new Set(CALL_LOGGING_SCOPES);

export const DEFAULT_OVERLAY_POLICY = {
  position: "top",
  auto_dismiss_seconds: 0,
  show_for: "incoming",
};

export const DEFAULT_CONTACT_SYNC_POLICY = {
  allowed_modes: [...CONTACT_SYNC_MODES],
  fields: ["name_and_number"],
};

export const DEFAULT_CALL_LOGGING_POLICY = {
  allowed_scopes: [...CALL_LOGGING_SCOPES],
  store_unknown_numbers: false,
  business_hours_only: false,
  business_hours: { from: "08:00", to: "18:00" },
  retention_days: 180,
};

export const DEFAULT_AFTER_CALL_TAGS = [
  "Booking",
  "Payment promise",
  "Extension",
  "Complaint",
  "Price enquiry",
  "Wrong number",
];

export const DEFAULT_AFTER_CALL_CARD_POLICY = {
  enabled: true,
  tags: [...DEFAULT_AFTER_CALL_TAGS],
  auto_dismiss_seconds: 25,
};

export const DEFAULT_CAPABILITIES_MAP = {
  signatures: true,
  photos: true,
  caller_brief: true,
  bill_view: true,
  push: true,
  contact_sync: true,
  call_logging: true,
  click_to_call: true,
};

export const DEFAULT_PHONE_ASSISTANT_POLICY = {
  approval_mode: "auto_approve_admin_phones",
  auto_suspend_days: 30,
  offline_wipe_days: 7,
  capabilities: { ...DEFAULT_CAPABILITIES_MAP },
  brief_profiles: DEFAULT_BRIEF_PROFILES.map((p) => ({ ...p, fields: [...p.fields] })),
  default_profile_by_role: {},
  fallback_profile: "counter",
  cache_scope: "all",
  overlay: { ...DEFAULT_OVERLAY_POLICY },
  unknown_caller: "show_not_in_geargrid",
  shared_number: "list_all",
  desktop_popup: { roles: [], size: "standard" },
  sync: { stale_after_minutes: 60, warn_after_hours: 24, show_sync_footer: "always" },
  call_screen: { allow_phone_text_scale: true, min: 0.8, max: 2, respect_system_font: true },
  notifications: {
    default_language: "en", allowed_languages: ["en", "si", "ta", "si-Latn"], bilingual: "off",
    format: { currency: "LKR", date: "dd MMM", time: "24h", digits: "latin" },
  },
  full_app: { enabled: true, require_app_lock: false, session_minutes: 30, block_screenshots: false },
  contact_sync: {
    allowed_modes: [...CONTACT_SYNC_MODES],
    fields: ["name_and_number"],
  },
  call_logging: {
    allowed_scopes: [...CALL_LOGGING_SCOPES],
    store_unknown_numbers: false,
    business_hours_only: false,
    business_hours: { from: "08:00", to: "18:00" },
    retention_days: 180,
  },
  after_call_card: {
    enabled: true,
    tags: [...DEFAULT_AFTER_CALL_TAGS],
    auto_dismiss_seconds: 25,
  },
};

const LANGUAGES = new Set(["en", "si", "ta", "si-Latn"]);
const CALL_SIZES = new Set(["compact", "standard", "large", "extra_large"]);
const CALL_ROW_STYLES = new Set(["title", "emphasis", "body", "caption", "stars", "list", "chip"]);
const CALL_RULES = new Set(["status_blacklisted", "balance_due_over", "overdue_days_over", "rating_under", "id_retained", "unknown_caller"]);
const CALL_ACTIONS = new Set(["dismiss", "add_note", "open_on_desktop", "open_app", "call_back_later"]);
const DEFAULT_CALL_SCREEN = {
  version: 1, size: "standard", text_scale: 1,
  shape: { width: "inset", corner_radius: 16, position: "top", opacity: 1, elevation: true },
  theme: { mode: "auto", accent: "brand", status_bar: true }, header: { show_logo: false, show_shop_name: false },
  rows: [{ field: "name", style: "title" }, { field: "rating", style: "stars" }, { field: "balance_due", style: "emphasis", label: true }, { field: "active_items", style: "list", max_items: 3 }],
  rules: [], actions: ["dismiss", "add_note", "open_on_desktop"],
  behaviour: { auto_dismiss_seconds: 0, draggable: true, tap_to_expand: true, show_for: "incoming", collapsed_rows: 2 }, locked: { mode: "name_rating" },
};

const scale = (value, fallback = 1) => {
  const n = Number(value); return Number.isFinite(n) && n >= 0.8 && n <= 2 && Math.round(n * 10) === n * 10 ? n : fallback;
};
export const normalizeCallScreen = (raw, allowedFields = null) => {
  const input = parseJsonField(raw, {});
  if (!input || Number(input.version) !== 1) return JSON.parse(JSON.stringify(DEFAULT_CALL_SCREEN));
  const fields = allowedFields ? new Set(allowedFields.includes("*") ? [...BRIEF_FIELD_KEY_SET] : allowedFields) : BRIEF_FIELD_KEY_SET;
  const rows = Array.isArray(input.rows) ? input.rows.filter((row) => row && fields.has(row.field) && CALL_ROW_STYLES.has(row.style)).slice(0, 16).map((row) => ({ field: row.field, style: row.style, ...(typeof row.label === "boolean" ? { label: row.label } : {}), ...(Number.isInteger(row.max_items) ? { max_items: Math.min(10, Math.max(1, row.max_items)) } : {}) })) : [];
  if (!rows.length) return JSON.parse(JSON.stringify(DEFAULT_CALL_SCREEN));
  const shape = input.shape || {}, theme = input.theme || {}, behaviour = input.behaviour || {}, locked = input.locked || {};
  return {
    version: 1, size: CALL_SIZES.has(input.size) ? input.size : "standard", text_scale: scale(input.text_scale),
    shape: { width: ["inset", "full"].includes(shape.width) ? shape.width : "inset", corner_radius: Number.isInteger(shape.corner_radius) ? Math.min(28, Math.max(0, shape.corner_radius)) : 16, position: ["top", "middle", "bottom"].includes(shape.position) ? shape.position : "top", opacity: Math.min(1, Math.max(0.8, Number(shape.opacity) || 1)), elevation: shape.elevation !== false },
    theme: { mode: ["auto", "light", "dark"].includes(theme.mode) ? theme.mode : "auto", accent: theme.accent === "neutral" ? "neutral" : "brand", status_bar: theme.status_bar !== false },
    header: { show_logo: Boolean(input.header?.show_logo), show_shop_name: Boolean(input.header?.show_shop_name) }, rows,
    rules: Array.isArray(input.rules) ? input.rules.filter((r) => r && CALL_RULES.has(r.when)).slice(0, 12).map((r) => ({ when: r.when, ...(Number.isFinite(Number(r.value)) ? { value: Number(r.value) } : {}), ...(r.accent === "danger" || r.accent === "warning" ? { accent: r.accent } : {}), ...(typeof r.banner === "boolean" ? { banner: r.banner } : {}), ...(typeof r.vibrate === "boolean" ? { vibrate: r.vibrate } : {}) })) : [],
    actions: Array.isArray(input.actions) ? [...new Set(input.actions.filter((a) => CALL_ACTIONS.has(a)))].slice(0, 3) : ["dismiss"],
    behaviour: { auto_dismiss_seconds: Number.isInteger(behaviour.auto_dismiss_seconds) ? Math.min(60, Math.max(0, behaviour.auto_dismiss_seconds)) : 0, draggable: behaviour.draggable !== false, tap_to_expand: behaviour.tap_to_expand !== false, show_for: behaviour.show_for === "incoming_and_outgoing" ? "incoming_and_outgoing" : "incoming", collapsed_rows: Number.isInteger(behaviour.collapsed_rows) ? Math.min(10, Math.max(1, behaviour.collapsed_rows)) : 2 },
    locked: { mode: LOCK_SCREEN_MODES.has(locked.mode) ? locked.mode : "name_rating" },
  };
};

export const isValidCacheScope = (scope) => {
  if (scope === "all" || scope === "with_dues_or_active") return true;
  const match = /^active_months:(\d+)$/.exec(String(scope || ""));
  if (!match) return false;
  const months = Number(match[1]);
  return Number.isInteger(months) && months >= 1 && months <= 120;
};

export const normalizeCapabilitiesMap = (raw, fallback = DEFAULT_CAPABILITIES_MAP) => {
  const parsed = parseJsonField(raw, {});
  const out = {};
  for (const key of DEVICE_CAPABILITY_KEYS) {
    out[key] = typeof parsed?.[key] === "boolean" ? parsed[key] : Boolean(fallback[key]);
  }
  return out;
};

const normalizeBriefProfilesList = (rawProfiles) => {
  if (!Array.isArray(rawProfiles) || rawProfiles.length === 0) {
    return DEFAULT_BRIEF_PROFILES.map((p) => ({ ...p, fields: [...p.fields], call_screen: normalizeCallScreen(null, p.fields) }));
  }
  const byId = new Map();
  for (const raw of rawProfiles) {
    const clean = normalizeBriefProfile(raw);
    if (!clean.id) continue;
    byId.set(clean.id, { ...clean, call_screen: normalizeCallScreen(raw?.call_screen, clean.fields) });
  }
  if (!byId.has("owner")) {
    byId.set("owner", { ...DEFAULT_BRIEF_PROFILES[0], fields: [...DEFAULT_BRIEF_PROFILES[0].fields], call_screen: normalizeCallScreen(null, DEFAULT_BRIEF_PROFILES[0].fields) });
  }
  if (!byId.has("counter")) {
    byId.set("counter", { ...DEFAULT_BRIEF_PROFILES[1], fields: [...DEFAULT_BRIEF_PROFILES[1].fields], call_screen: normalizeCallScreen(null, DEFAULT_BRIEF_PROFILES[1].fields) });
  }
  return Array.from(byId.values());
};

const normalizeDefaultProfileByRole = (rawMap, profiles) => {
  const validIds = new Set(profiles.map((p) => p.id));
  const parsed = parseJsonField(rawMap, {});
  const out = {};
  if (parsed && typeof parsed === "object") {
    for (const [roleId, profileId] of Object.entries(parsed)) {
      const pid = String(profileId || "").trim();
      if (/^\d+$/.test(String(roleId)) && validIds.has(pid)) {
        out[String(roleId)] = pid;
      }
    }
  }
  return out;
};

const normalizeOverlayPolicy = (rawOverlay) => {
  const parsed = parseJsonField(rawOverlay, {});
  const position = OVERLAY_POSITIONS.has(parsed?.position)
    ? parsed.position
    : DEFAULT_OVERLAY_POLICY.position;
  const dismissRaw = Number(parsed?.auto_dismiss_seconds);
  const auto_dismiss_seconds =
    Number.isInteger(dismissRaw) && dismissRaw >= 0 && dismissRaw <= 60
      ? dismissRaw
      : DEFAULT_OVERLAY_POLICY.auto_dismiss_seconds;
  const show_for = OVERLAY_SHOW_FOR_MODES.has(parsed?.show_for)
    ? parsed.show_for
    : DEFAULT_OVERLAY_POLICY.show_for;
  return { position, auto_dismiss_seconds, show_for };
};

const normalizeContactSyncPolicy = (rawContactSync) => {
  const parsed = parseJsonField(rawContactSync, {});
  const parseModes = Array.isArray(parsed?.allowed_modes)
    ? parsed.allowed_modes
    : DEFAULT_CONTACT_SYNC_POLICY.allowed_modes;
  const allowed_modes = [
    ...new Set([
      "off",
      ...parseModes
        .map((m) => String(m || "").trim())
        .filter((m) => CONTACT_SYNC_MODE_SET.has(m)),
    ]),
  ];
  return {
    allowed_modes,
    fields: ["name_and_number"],
  };
};

const normalizeCallLoggingPolicy = (rawCallLogging) => {
  const parsed = parseJsonField(rawCallLogging, {});
  const parseScopes = Array.isArray(parsed?.allowed_scopes)
    ? parsed.allowed_scopes
    : DEFAULT_CALL_LOGGING_POLICY.allowed_scopes;
  const allowed_scopes = [
    ...new Set([
      "off",
      ...parseScopes
        .map((s) => String(s || "").trim())
        .filter((s) => CALL_LOGGING_SCOPE_SET.has(s)),
    ]),
  ];
  const timeRe = /^\d{2}:\d{2}$/;
  const from = timeRe.test(String(parsed?.business_hours?.from || ""))
    ? String(parsed.business_hours.from)
    : DEFAULT_CALL_LOGGING_POLICY.business_hours.from;
  const to = timeRe.test(String(parsed?.business_hours?.to || ""))
    ? String(parsed.business_hours.to)
    : DEFAULT_CALL_LOGGING_POLICY.business_hours.to;
  const retentionRaw = Number(parsed?.retention_days);
  const retention_days =
    Number.isInteger(retentionRaw) && retentionRaw >= 1 && retentionRaw <= 3650
      ? retentionRaw
      : DEFAULT_CALL_LOGGING_POLICY.retention_days;
  return {
    allowed_scopes,
    store_unknown_numbers: Boolean(parsed?.store_unknown_numbers),
    business_hours_only: Boolean(parsed?.business_hours_only),
    business_hours: { from, to },
    retention_days,
  };
};

export const normalizeAfterCallCardPolicy = (rawAfterCall) => {
  const parsed = parseJsonField(rawAfterCall, {});
  const enabled =
    typeof parsed?.enabled === "boolean"
      ? parsed.enabled
      : DEFAULT_AFTER_CALL_CARD_POLICY.enabled;
  const rawTags = Array.isArray(parsed?.tags) ? parsed.tags : DEFAULT_AFTER_CALL_TAGS;
  const tags = [
    ...new Set(
      rawTags
        .map((t) => String(t || "").trim().slice(0, 60))
        .filter(Boolean),
    ),
  ].slice(0, 20);
  const dismissRaw = Number(parsed?.auto_dismiss_seconds);
  const auto_dismiss_seconds =
    Number.isInteger(dismissRaw) && dismissRaw >= 0 && dismissRaw <= 120
      ? dismissRaw
      : DEFAULT_AFTER_CALL_CARD_POLICY.auto_dismiss_seconds;
  return {
    enabled,
    tags: tags.length > 0 ? tags : [...DEFAULT_AFTER_CALL_TAGS],
    auto_dismiss_seconds,
  };
};

const normalizeRelease3Policy = (raw = {}) => {
  const syncRaw = parseJsonField(raw.sync, {}), callRaw = parseJsonField(raw.call_screen, {}), notifyRaw = parseJsonField(raw.notifications, {}), fullRaw = parseJsonField(raw.full_app, {});
  const min = scale(callRaw.min, 0.8), max = scale(callRaw.max, 2);
  const allowed = Array.isArray(notifyRaw.allowed_languages) ? [...new Set(notifyRaw.allowed_languages.filter((x) => LANGUAGES.has(x)))] : [...DEFAULT_PHONE_ASSISTANT_POLICY.notifications.allowed_languages];
  return {
    sync: { stale_after_minutes: Number.isInteger(Number(syncRaw.stale_after_minutes)) ? Math.min(10080, Math.max(1, Number(syncRaw.stale_after_minutes))) : 60, warn_after_hours: Number.isInteger(Number(syncRaw.warn_after_hours)) ? Math.min(8760, Math.max(1, Number(syncRaw.warn_after_hours))) : 24, show_sync_footer: ["always", "only_when_stale", "never"].includes(syncRaw.show_sync_footer) ? syncRaw.show_sync_footer : "always" },
    call_screen: { allow_phone_text_scale: callRaw.allow_phone_text_scale !== false, min: Math.min(min, max), max: Math.max(min, max), respect_system_font: callRaw.respect_system_font !== false },
    notifications: { default_language: LANGUAGES.has(notifyRaw.default_language) ? notifyRaw.default_language : "en", allowed_languages: allowed.length ? allowed : ["en"], bilingual: notifyRaw.bilingual === "append_english" ? "append_english" : "off", format: { currency: ["LKR", "Rs.", "රු."].includes(notifyRaw.format?.currency) ? notifyRaw.format.currency : "LKR", date: ["yyyy-mm-dd", "dd MMM", "dd/mm"].includes(notifyRaw.format?.date) ? notifyRaw.format.date : "dd MMM", time: notifyRaw.format?.time === "12h" ? "12h" : "24h", digits: "latin" } },
    full_app: { enabled: fullRaw.enabled !== false, require_app_lock: Boolean(fullRaw.require_app_lock), session_minutes: Number.isInteger(Number(fullRaw.session_minutes)) ? Math.min(1440, Math.max(1, Number(fullRaw.session_minutes))) : 30, block_screenshots: Boolean(fullRaw.block_screenshots) },
  };
};

export const mergePhoneAssistantPolicy = (rawPa) => {
  const parsed = parseJsonField(rawPa, {});
  const approvalMode = APPROVAL_MODES.has(parsed?.approval_mode)
    ? parsed.approval_mode
    : DEFAULT_PHONE_ASSISTANT_POLICY.approval_mode;

  const autoSuspendRaw = Number(parsed?.auto_suspend_days);
  const autoSuspendDays =
    Number.isInteger(autoSuspendRaw) && autoSuspendRaw >= 0 && autoSuspendRaw <= 365
      ? autoSuspendRaw
      : DEFAULT_PHONE_ASSISTANT_POLICY.auto_suspend_days;

  const offlineWipeRaw = Number(parsed?.offline_wipe_days);
  const offlineWipeDays =
    Number.isInteger(offlineWipeRaw) && offlineWipeRaw >= 1 && offlineWipeRaw <= 30
      ? offlineWipeRaw
      : DEFAULT_PHONE_ASSISTANT_POLICY.offline_wipe_days;

  const briefProfiles = normalizeBriefProfilesList(parsed?.brief_profiles);
  const validProfileIds = new Set(briefProfiles.map((p) => p.id));
  const fallbackProfile = validProfileIds.has(parsed?.fallback_profile)
    ? parsed.fallback_profile
    : validProfileIds.has("counter")
      ? "counter"
      : briefProfiles[0].id;

  const cacheScope = isValidCacheScope(parsed?.cache_scope)
    ? String(parsed.cache_scope)
    : DEFAULT_PHONE_ASSISTANT_POLICY.cache_scope;

  const unknownCaller = UNKNOWN_CALLER_MODES.has(parsed?.unknown_caller)
    ? parsed.unknown_caller
    : DEFAULT_PHONE_ASSISTANT_POLICY.unknown_caller;

  const sharedNumber = SHARED_NUMBER_MODES.has(parsed?.shared_number)
    ? parsed.shared_number
    : DEFAULT_PHONE_ASSISTANT_POLICY.shared_number;

  const rawPopupRoles = Array.isArray(parsed?.desktop_popup?.roles)
    ? parsed.desktop_popup.roles
    : [];
  const desktopPopupRoles = [
    ...new Set(rawPopupRoles.map((r) => Number(r)).filter((r) => Number.isInteger(r) && r > 0)),
  ];

  const release3 = normalizeRelease3Policy(parsed);
  return {
    approval_mode: approvalMode,
    auto_suspend_days: autoSuspendDays,
    offline_wipe_days: offlineWipeDays,
    capabilities: normalizeCapabilitiesMap(parsed?.capabilities, DEFAULT_CAPABILITIES_MAP),
    brief_profiles: briefProfiles,
    default_profile_by_role: normalizeDefaultProfileByRole(
      parsed?.default_profile_by_role,
      briefProfiles,
    ),
    fallback_profile: fallbackProfile,
    cache_scope: cacheScope,
    overlay: normalizeOverlayPolicy(parsed?.overlay),
    unknown_caller: unknownCaller,
    shared_number: sharedNumber,
    desktop_popup: { roles: desktopPopupRoles },
    ...release3,
    contact_sync: normalizeContactSyncPolicy(parsed?.contact_sync),
    call_logging: normalizeCallLoggingPolicy(parsed?.call_logging),
    after_call_card: normalizeAfterCallCardPolicy(parsed?.after_call_card),
  };
};

export const resolveDeviceBriefProfile = (device, userCtx, policy) => {
  const merged = policy?.brief_profiles ? policy : mergePhoneAssistantPolicy(policy);
  const profiles = merged.brief_profiles || DEFAULT_BRIEF_PROFILES;
  const findById = (id) => (id ? profiles.find((p) => p.id === id) || null : null);

  if (device?.brief_profile_id) {
    const direct = findById(String(device.brief_profile_id));
    if (direct) return direct;
  }

  if (userCtx?.primaryRoleId) {
    const roleProfileId = merged.default_profile_by_role?.[String(userCtx.primaryRoleId)];
    const roleMatch = findById(roleProfileId);
    if (roleMatch) return roleMatch;
  }

  if (userCtx?.isAdmin) {
    const ownerProfile = findById("owner");
    if (ownerProfile) return ownerProfile;
  }

  return findById(merged.fallback_profile) || findById("counter") || profiles[0];
};

export const assertDeviceSettingsWithinPolicy = (
  policy,
  { contact_sync_mode, call_logging_scope } = {},
) => {
  if (contact_sync_mode !== undefined) {
    if (!CONTACT_SYNC_MODE_SET.has(contact_sync_mode)) {
      throw new AppError(`Invalid contact_sync_mode: ${contact_sync_mode}`, 400);
    }
    const allowedModes = policy?.contact_sync?.allowed_modes || CONTACT_SYNC_MODES;
    if (!allowedModes.includes(contact_sync_mode)) {
      throw new AppError(
        `Contact sync mode "${contact_sync_mode}" is not allowed by shop policy.`,
        400,
        "policy_disallowed",
      );
    }
  }
  if (call_logging_scope !== undefined) {
    if (!CALL_LOGGING_SCOPE_SET.has(call_logging_scope)) {
      throw new AppError(`Invalid call_logging_scope: ${call_logging_scope}`, 400);
    }
    const allowedScopes = policy?.call_logging?.allowed_scopes || CALL_LOGGING_SCOPES;
    if (!allowedScopes.includes(call_logging_scope)) {
      throw new AppError(
        `Call logging scope "${call_logging_scope}" is not allowed by shop policy.`,
        400,
        "policy_disallowed",
      );
    }
  }
};

export const getPhoneAssistantPolicy = async (models) => {
  const config = models?.TenantConfig?.findOne ? await models.TenantConfig.findOne() : null;
  const custom = parseJsonField(config?.custom_settings, {});
  const pa = parseJsonField(custom?.phone_assistant, {});
  return {
    policy: mergePhoneAssistantPolicy(pa),
  };
};

export const updatePhoneAssistantPolicy = async (models, payload = {}) => {
  if (
    payload.approval_mode !== undefined &&
    !APPROVAL_MODES.has(payload.approval_mode)
  ) {
    throw new AppError("Invalid approval_mode value.", 400);
  }
  if (payload.auto_suspend_days !== undefined) {
    const n = Number(payload.auto_suspend_days);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      throw new AppError("auto_suspend_days must be an integer between 0 and 365.", 400);
    }
  }
  if (payload.offline_wipe_days !== undefined) {
    const n = Number(payload.offline_wipe_days);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      throw new AppError("offline_wipe_days must be an integer between 1 and 30.", 400);
    }
  }
  if (payload.capabilities !== undefined) {
    if (!payload.capabilities || typeof payload.capabilities !== "object") {
      throw new AppError("capabilities must be an object.", 400);
    }
    for (const [key, val] of Object.entries(payload.capabilities)) {
      if (!DEVICE_CAPABILITY_KEYS.includes(key)) {
        throw new AppError(`Unknown device capability: ${key}`, 400);
      }
      if (typeof val !== "boolean") {
        throw new AppError(`Capability ${key} must be a boolean.`, 400);
      }
    }
  }
  if (payload.brief_profiles !== undefined) {
    if (!Array.isArray(payload.brief_profiles) || payload.brief_profiles.length === 0) {
      throw new AppError("brief_profiles must be a non-empty array.", 400);
    }
    for (const p of payload.brief_profiles) {
      if (!p || typeof p !== "object" || !String(p.id || "").trim() || !String(p.name || "").trim()) {
        throw new AppError("Each brief profile must have an id and name.", 400);
      }
      if (!LOCK_SCREEN_MODES.has(p.lock_screen)) {
        throw new AppError(`Invalid lock_screen mode in profile ${p.id}.`, 400);
      }
      if (!AMOUNT_MODES.has(p.amounts)) {
        throw new AppError(`Invalid amounts mode in profile ${p.id}.`, 400);
      }
      if (!Array.isArray(p.fields)) {
        throw new AppError(`Profile ${p.id} must specify a fields array.`, 400);
      }
      for (const f of p.fields) {
        if (f !== "*" && !BRIEF_FIELD_KEY_SET.has(f)) {
          throw new AppError(`Unknown brief field: ${f}`, 400);
        }
      }
      if (p.call_screen !== undefined) {
        if (!p.call_screen || typeof p.call_screen !== "object" || Number(p.call_screen.version) !== 1) {
          throw new AppError(`Profile ${p.id} has an unsupported call_screen version.`, 400);
        }
        const normalized = normalizeCallScreen(p.call_screen, p.fields);
        if (!normalized.rows.length) throw new AppError(`Profile ${p.id} call_screen needs at least one allowed row.`, 400);
      }
    }
  }
  if (payload.cache_scope !== undefined && !isValidCacheScope(payload.cache_scope)) {
    throw new AppError("Invalid cache_scope value.", 400);
  }
  if (payload.overlay !== undefined) {
    if (!payload.overlay || typeof payload.overlay !== "object") {
      throw new AppError("overlay must be an object.", 400);
    }
    if (payload.overlay.position !== undefined && !OVERLAY_POSITIONS.has(payload.overlay.position)) {
      throw new AppError("Invalid overlay.position value.", 400);
    }
    if (payload.overlay.auto_dismiss_seconds !== undefined) {
      const n = Number(payload.overlay.auto_dismiss_seconds);
      if (!Number.isInteger(n) || n < 0 || n > 60) {
        throw new AppError("overlay.auto_dismiss_seconds must be 0..60.", 400);
      }
    }
    if (
      payload.overlay.show_for !== undefined &&
      !OVERLAY_SHOW_FOR_MODES.has(payload.overlay.show_for)
    ) {
      throw new AppError("Invalid overlay.show_for value.", 400);
    }
  }
  if (
    payload.unknown_caller !== undefined &&
    !UNKNOWN_CALLER_MODES.has(payload.unknown_caller)
  ) {
    throw new AppError("Invalid unknown_caller value.", 400);
  }
  if (payload.shared_number !== undefined && !SHARED_NUMBER_MODES.has(payload.shared_number)) {
    throw new AppError("Invalid shared_number value.", 400);
  }
  if (payload.contact_sync !== undefined) {
    if (!payload.contact_sync || typeof payload.contact_sync !== "object") {
      throw new AppError("contact_sync must be an object.", 400);
    }
    if (payload.contact_sync.allowed_modes !== undefined) {
      if (!Array.isArray(payload.contact_sync.allowed_modes)) {
        throw new AppError("contact_sync.allowed_modes must be an array.", 400);
      }
      for (const m of payload.contact_sync.allowed_modes) {
        if (!CONTACT_SYNC_MODE_SET.has(m)) {
          throw new AppError(`Invalid contact_sync mode: ${m}`, 400);
        }
      }
    }
  }
  if (payload.call_logging !== undefined) {
    if (!payload.call_logging || typeof payload.call_logging !== "object") {
      throw new AppError("call_logging must be an object.", 400);
    }
    if (payload.call_logging.allowed_scopes !== undefined) {
      if (!Array.isArray(payload.call_logging.allowed_scopes)) {
        throw new AppError("call_logging.allowed_scopes must be an array.", 400);
      }
      for (const s of payload.call_logging.allowed_scopes) {
        if (!CALL_LOGGING_SCOPE_SET.has(s)) {
          throw new AppError(`Invalid call_logging scope: ${s}`, 400);
        }
      }
    }
    if (payload.call_logging.retention_days !== undefined) {
      const r = Number(payload.call_logging.retention_days);
      if (!Number.isInteger(r) || r < 1 || r > 3650) {
        throw new AppError("call_logging.retention_days must be 1..3650.", 400);
      }
    }
    if (payload.call_logging.business_hours !== undefined) {
      const { from, to } = payload.call_logging.business_hours || {};
      const timeRe = /^\d{2}:\d{2}$/;
      if ((from !== undefined && !timeRe.test(String(from))) || (to !== undefined && !timeRe.test(String(to)))) {
        throw new AppError("call_logging.business_hours from/to must be HH:MM.", 400);
      }
    }
  }
  if (payload.after_call_card !== undefined) {
    if (!payload.after_call_card || typeof payload.after_call_card !== "object") {
      throw new AppError("after_call_card must be an object.", 400);
    }
    if (
      payload.after_call_card.enabled !== undefined &&
      typeof payload.after_call_card.enabled !== "boolean"
    ) {
      throw new AppError("after_call_card.enabled must be a boolean.", 400);
    }
    if (payload.after_call_card.tags !== undefined) {
      if (
        !Array.isArray(payload.after_call_card.tags) ||
        payload.after_call_card.tags.length === 0 ||
        payload.after_call_card.tags.some((t) => typeof t !== "string" || !t.trim())
      ) {
        throw new AppError("after_call_card.tags must be a non-empty array of strings.", 400);
      }
    }
    if (payload.after_call_card.auto_dismiss_seconds !== undefined) {
      const n = Number(payload.after_call_card.auto_dismiss_seconds);
      if (!Number.isInteger(n) || n < 0 || n > 120) {
        throw new AppError("after_call_card.auto_dismiss_seconds must be 0..120.", 400);
      }
    }
  }
  for (const [key, max] of [["sync.stale_after_minutes", 10080], ["sync.warn_after_hours", 8760]]) {
    const [root, child] = key.split(".");
    if (payload[root]?.[child] !== undefined && (!Number.isInteger(Number(payload[root][child])) || Number(payload[root][child]) < 1 || Number(payload[root][child]) > max)) throw new AppError(`${key} is outside its allowed range.`, 400);
  }
  if (payload.sync?.show_sync_footer !== undefined && !["always", "only_when_stale", "never"].includes(payload.sync.show_sync_footer)) throw new AppError("Invalid sync.show_sync_footer value.", 400);
  if (payload.call_screen !== undefined) {
    const p = payload.call_screen;
    if (p.min !== undefined && (!Number.isFinite(Number(p.min)) || Number(p.min) < 0.8 || Number(p.min) > 2)) throw new AppError("call_screen.min must be 0.8..2.", 400);
    if (p.max !== undefined && (!Number.isFinite(Number(p.max)) || Number(p.max) < 0.8 || Number(p.max) > 2)) throw new AppError("call_screen.max must be 0.8..2.", 400);
  }
  if (payload.notifications !== undefined) {
    const n = payload.notifications;
    if (n.default_language !== undefined && !LANGUAGES.has(n.default_language)) throw new AppError("Unsupported notification language.", 400);
    if (n.allowed_languages !== undefined && (!Array.isArray(n.allowed_languages) || !n.allowed_languages.length || n.allowed_languages.some((x) => !LANGUAGES.has(x)))) throw new AppError("notifications.allowed_languages is invalid.", 400);
  }

  let config = models?.TenantConfig?.findOne ? await models.TenantConfig.findOne() : null;
  if (!config) {
    if (!models?.TenantConfig?.create) {
      throw new AppError("Tenant config missing.", 500);
    }
    config = await models.TenantConfig.create({ custom_settings: {} });
  }

  const custom = parseJsonField(config.custom_settings, {});
  const pa = parseJsonField(custom.phone_assistant, {});
  const current = mergePhoneAssistantPolicy(pa);

  const next = mergePhoneAssistantPolicy({
    ...current,
    ...(payload.approval_mode !== undefined ? { approval_mode: payload.approval_mode } : {}),
    ...(payload.auto_suspend_days !== undefined
      ? { auto_suspend_days: Number(payload.auto_suspend_days) }
      : {}),
    ...(payload.offline_wipe_days !== undefined
      ? { offline_wipe_days: Number(payload.offline_wipe_days) }
      : {}),
    ...(payload.capabilities !== undefined
      ? { capabilities: { ...current.capabilities, ...payload.capabilities } }
      : {}),
    ...(payload.brief_profiles !== undefined ? { brief_profiles: payload.brief_profiles } : {}),
    ...(payload.default_profile_by_role !== undefined
      ? { default_profile_by_role: payload.default_profile_by_role }
      : {}),
    ...(payload.fallback_profile !== undefined
      ? { fallback_profile: payload.fallback_profile }
      : {}),
    ...(payload.cache_scope !== undefined ? { cache_scope: payload.cache_scope } : {}),
    ...(payload.overlay !== undefined
      ? { overlay: { ...current.overlay, ...payload.overlay } }
      : {}),
    ...(payload.unknown_caller !== undefined ? { unknown_caller: payload.unknown_caller } : {}),
    ...(payload.shared_number !== undefined ? { shared_number: payload.shared_number } : {}),
    ...(payload.desktop_popup !== undefined ? { desktop_popup: payload.desktop_popup } : {}),
    ...(payload.sync !== undefined ? { sync: { ...current.sync, ...payload.sync } } : {}),
    ...(payload.call_screen !== undefined ? { call_screen: { ...current.call_screen, ...payload.call_screen } } : {}),
    ...(payload.notifications !== undefined ? { notifications: { ...current.notifications, ...payload.notifications, ...(payload.notifications.format ? { format: { ...current.notifications.format, ...payload.notifications.format } } : {}) } } : {}),
    ...(payload.full_app !== undefined ? { full_app: { ...current.full_app, ...payload.full_app } } : {}),
    ...(payload.contact_sync !== undefined
      ? { contact_sync: { ...current.contact_sync, ...payload.contact_sync } }
      : {}),
    ...(payload.call_logging !== undefined
      ? { call_logging: { ...current.call_logging, ...payload.call_logging } }
      : {}),
    ...(payload.after_call_card !== undefined
      ? { after_call_card: { ...current.after_call_card, ...payload.after_call_card } }
      : {}),
  });

  if (
    payload.fallback_profile !== undefined &&
    !next.brief_profiles.some((p) => p.id === payload.fallback_profile)
  ) {
    throw new AppError(`Unknown fallback_profile: ${payload.fallback_profile}`, 400);
  }

  await config.update({
    custom_settings: {
      ...custom,
      phone_assistant: {
        ...pa,
        approval_mode: next.approval_mode,
        auto_suspend_days: next.auto_suspend_days,
        offline_wipe_days: next.offline_wipe_days,
        capabilities: next.capabilities,
        brief_profiles: next.brief_profiles,
        default_profile_by_role: next.default_profile_by_role,
        fallback_profile: next.fallback_profile,
        cache_scope: next.cache_scope,
        overlay: next.overlay,
        unknown_caller: next.unknown_caller,
        shared_number: next.shared_number,
        desktop_popup: next.desktop_popup,
        sync: next.sync,
        call_screen: next.call_screen,
        notifications: next.notifications,
        full_app: next.full_app,
        contact_sync: next.contact_sync,
        call_logging: next.call_logging,
        after_call_card: next.after_call_card,
      },
    },
  });

  const briefPolicyChanged =
    JSON.stringify(current.brief_profiles) !== JSON.stringify(next.brief_profiles) ||
    JSON.stringify(current.default_profile_by_role) !==
      JSON.stringify(next.default_profile_by_role) ||
    current.fallback_profile !== next.fallback_profile ||
    current.cache_scope !== next.cache_scope;

  const anyDevicePolicyChanged =
    briefPolicyChanged ||
    JSON.stringify(current.capabilities) !== JSON.stringify(next.capabilities) ||
    JSON.stringify(current.overlay) !== JSON.stringify(next.overlay) ||
    JSON.stringify(current.contact_sync) !== JSON.stringify(next.contact_sync) ||
    JSON.stringify(current.call_logging) !== JSON.stringify(next.call_logging) ||
    JSON.stringify(current.after_call_card) !== JSON.stringify(next.after_call_card) ||
    JSON.stringify(current.sync) !== JSON.stringify(next.sync) ||
    JSON.stringify(current.call_screen) !== JSON.stringify(next.call_screen) ||
    JSON.stringify(current.notifications) !== JSON.stringify(next.notifications) ||
    JSON.stringify(current.full_app) !== JSON.stringify(next.full_app) ||
    current.unknown_caller !== next.unknown_caller ||
    current.shared_number !== next.shared_number ||
    current.offline_wipe_days !== next.offline_wipe_days;

  if (briefPolicyChanged && models?.OperatorDevice?.update) {
    await models.OperatorDevice.update(
      { briefs_synced_at: null },
      { where: { is_native_app: true, status: { [Op.ne]: "REVOKED" } } },
    ).catch(() => {});
  }

  if (anyDevicePolicyChanged && models?.OperatorDevice?.findAll) {
    try {
      const devices = await models.OperatorDevice.findAll({
        where: {
          is_native_app: true,
          status: { [Op.ne]: "REVOKED" },
          push_token: { [Op.ne]: null },
        },
      });
      for (const dev of devices || []) {
        if (briefPolicyChanged) {
          await sendDataPush(dev, { type: "wipe_cache" }).catch(() => {});
        }
        await sendDataPush(dev, { type: "policy_changed" }).catch(() => {});
      }
    } catch {
      // Best-effort policy push notification
    }
  }

  return { policy: next };
};

/** Applies narrowly-scoped policy edits without allowing arbitrary document writes. */
export const patchPhoneAssistantPolicy = async (models, updates = []) => {
  const allowed = new Set([
    "sync.stale_after_minutes", "sync.warn_after_hours", "sync.show_sync_footer",
    "call_screen.allow_phone_text_scale", "call_screen.min", "call_screen.max", "call_screen.respect_system_font",
    "notifications.default_language", "notifications.allowed_languages", "notifications.bilingual", "notifications.format.currency", "notifications.format.date", "notifications.format.time", "notifications.format.digits",
    "full_app.enabled", "full_app.require_app_lock", "full_app.session_minutes", "full_app.block_screenshots",
  ]);
  const payload = {};
  for (const update of updates) {
    if (!allowed.has(update?.path)) throw new AppError(`Policy path is not editable: ${update?.path}`, 400);
    const parts = update.path.split(".");
    let node = payload;
    for (const part of parts.slice(0, -1)) node = node[part] ||= {};
    node[parts.at(-1)] = update.value;
  }
  return updatePhoneAssistantPolicy(models, payload);
};

/**
 * Load effective role+override permissions for a User object.
 * Returns { user, isAdmin, permissionSet, primaryRoleId }.
 */
export const loadUserCapabilitiesContext = async (models, userOrId) => {
  let user = typeof userOrId === "object" && userOrId ? userOrId : null;
  const userId = user ? user.user_id : userOrId;

  const hasLoadedRoles =
    user &&
    Array.isArray(user.Roles) &&
    user.Roles.every((r) => Array.isArray(r.Permissions) || isUserAdmin(user));

  if (!hasLoadedRoles && userId && models?.User?.findByPk) {
    const roleInclude = models.Role
      ? [
          {
            model: models.Role,
            attributes: ["role_id", "role_name", "hierarchy_level", "is_active"],
            through: { attributes: [] },
            ...(models.Permission
              ? {
                  include: [
                    {
                      model: models.Permission,
                      attributes: ["permission_code"],
                      through: { attributes: [] },
                    },
                  ],
                }
              : {}),
          },
        ]
      : [];
    const loaded = await models.User.findByPk(userId, {
      attributes: ["user_id", "first_name", "last_name", "username", "email", "is_active"],
      ...(roleInclude.length > 0 ? { include: roleInclude } : {}),
    });
    if (loaded) user = loaded;
  }

  const admin = isUserAdmin(user);
  const permissionSet = new Set();
  let primaryRoleId = null;
  let highestHierarchy = -Infinity;

  if (user && user.is_active !== false) {
    const roles = Array.isArray(user.Roles) ? user.Roles : [];
    for (const role of roles) {
      if (!role || role.is_active === false) continue;
      const lvl = Number(role.hierarchy_level || 0);
      if (role.role_id && lvl > highestHierarchy) {
        highestHierarchy = lvl;
        primaryRoleId = Number(role.role_id);
      }
      for (const perm of role.Permissions || []) {
        if (perm?.permission_code) permissionSet.add(perm.permission_code);
      }
    }
    if (!admin && models?.UserPermissionOverride?.findAll && user.user_id) {
      const overrides = await models.UserPermissionOverride.findAll({
        where: { user_id: user.user_id },
        include: models.Permission
          ? [{ model: models.Permission, attributes: ["permission_code"] }]
          : [],
      });
      for (const ov of overrides || []) {
        const code = ov.Permission?.permission_code;
        if (!code) continue;
        if (ov.grant_type === "grant") permissionSet.add(code);
        else if (ov.grant_type === "revoke") permissionSet.delete(code);
      }
    }
  }

  return { user, isAdmin: admin, permissionSet, primaryRoleId };
};

const ROLE_REQUIREMENTS = {
  signatures: null,
  photos: null,
  caller_brief: "calls:view",
  bill_view: "invoice:view",
  push: null,
  contact_sync: null,
  call_logging: null,
  click_to_call: "calls:view",
};

/**
 * Compute per-capability granted, effective and blocking reason for a device (B.2).
 */
export const resolveDeviceCapabilities = ({
  device,
  isAdmin = false,
  permissionSet = new Set(),
  policy = DEFAULT_PHONE_ASSISTANT_POLICY,
  planHasPhoneAssistant = true,
  userActive = true,
}) => {
  const granted = normalizeCapabilitiesMap(device?.capabilities, DEFAULT_CAPABILITIES_MAP);
  const reported = parseJsonField(device?.reported_state, null);
  const deviceStatus = device?.status || "ACTIVE";

  const effective = {};
  const reasons = {};

  const checkRolePerm = (cap) => {
    const reqPerm = ROLE_REQUIREMENTS[cap];
    if (!reqPerm) return true;
    if (isAdmin) return true;
    return permissionSet instanceof Set ? permissionSet.has(reqPerm) : false;
  };

  const checkPhoneSwitch = (cap) => {
    if (cap === "contact_sync") {
      const mode = device?.contact_sync_mode;
      if (device?.contact_sync_enabled) return true;
      if (mode && mode !== "off") return true;
      return false;
    }
    if (cap === "call_logging") {
      return (device?.call_logging_scope || "customers_and_contacts") !== "off";
    }
    if (cap === "click_to_call") {
      if (reported && reported.click_to_call_enabled === false) return false;
      return true;
    }
    return true;
  };

  const checkOsPermission = (cap) => {
    if (!reported || typeof reported !== "object") return true;
    if (cap === "caller_brief") {
      return (
        reported.call_screening_role !== false && reported.overlay_permission !== false
      );
    }
    if (cap === "push") {
      return reported.notifications_permission !== false;
    }
    if (cap === "contact_sync") {
      return reported.contacts_permission !== false;
    }
    if (cap === "call_logging") {
      return reported.call_log_permission !== false;
    }
    return true;
  };

  for (const cap of DEVICE_CAPABILITY_KEYS) {
    if (deviceStatus === "REVOKED" || !userActive) {
      effective[cap] = false;
      reasons[cap] = "device_revoked";
      continue;
    }
    if (deviceStatus === "SUSPENDED") {
      effective[cap] = false;
      reasons[cap] = "device_suspended";
      continue;
    }
    if (deviceStatus === "PENDING" && cap !== "signatures" && cap !== "photos") {
      effective[cap] = false;
      reasons[cap] = "device_pending";
      continue;
    }
    if (PHONE_ASSISTANT_CAPABILITY_KEYS.has(cap) && !planHasPhoneAssistant) {
      effective[cap] = false;
      reasons[cap] = "plan";
      continue;
    }
    if (policy?.capabilities?.[cap] === false) {
      effective[cap] = false;
      reasons[cap] = "shop_policy";
      continue;
    }
    if (granted[cap] === false) {
      effective[cap] = false;
      reasons[cap] = "not_granted";
      continue;
    }
    if (!checkRolePerm(cap)) {
      effective[cap] = false;
      reasons[cap] = "role";
      continue;
    }
    if (!checkPhoneSwitch(cap)) {
      effective[cap] = false;
      reasons[cap] = "phone_switch";
      continue;
    }
    if (!checkOsPermission(cap)) {
      effective[cap] = false;
      reasons[cap] = "os_permission";
      continue;
    }

    effective[cap] = true;
    reasons[cap] = null;
  }

  return { granted, effective, reasons };
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const computeDeviceHealthWarnings = (device, nowMs = Date.now()) => {
  const warnings = [];
  const status = device?.status || "ACTIVE";
  if (status === "PENDING") warnings.push("pending_approval");
  if (status === "SUSPENDED") warnings.push("suspended");
  if (status !== "REVOKED" && device?.last_seen_at) {
    const lastMs = new Date(device.last_seen_at).getTime();
    if (Number.isFinite(lastMs) && nowMs - lastMs > SEVEN_DAYS_MS) {
      warnings.push("not_seen_7d");
    }
  }
  const reported = parseJsonField(device?.reported_state, null);
  if (device?.is_native_app && reported && typeof reported === "object") {
    if (reported.notifications_permission === false) warnings.push("notifications_off");
    if (reported.call_screening_role === false) warnings.push("call_screening_off");
    if (reported.overlay_permission === false) warnings.push("overlay_off");
    if (reported.battery_optimization_exempt === false) warnings.push("battery_restricted");
    const syncOn =
      Boolean(device?.contact_sync_enabled) ||
      (device?.contact_sync_mode && device.contact_sync_mode !== "off");
    if (syncOn && reported.contacts_permission === false) {
      warnings.push("contacts_permission_off");
    }
  }
  return warnings;
};
