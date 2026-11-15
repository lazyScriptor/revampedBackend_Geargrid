import crypto from "node:crypto";
import { Op } from "sequelize";
import AppError from "../utils/AppError.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { getMasterModels } from "../models/master/index.js";
import { getTenantPlan } from "./planService.js";
import { isUserAdmin } from "./userService.js";
import { isPaymentLocked } from "../config/paymentNotice.js";
import { parseJsonField } from "../utils/jsonFields.js";
import { sendDataPush, sendPushToDevice } from "./devicePushService.js";
import { emitToTenant, emitToUser } from "../sockets/emitters.js";
import {
  DEFAULT_AFTER_CALL_CARD_POLICY,
  DEFAULT_CAPABILITIES_MAP,
  DEVICE_CAPABILITY_KEYS,
  assertDeviceSettingsWithinPolicy,
  computeDeviceHealthWarnings,
  getPhoneAssistantPolicy,
  loadUserCapabilitiesContext,
  normalizeCapabilitiesMap,
  resolveDeviceBriefProfile,
  resolveDeviceCapabilities,
} from "./phoneAssistantPolicyService.js";

// ─────────────────────────────────────────────────────────────────────────
// Paired-PWA device subsystem (POS-mints-code variant)
//
// Flow:
//   1. Operator (auth) on POS → mintPairingCode → row inserted in
//      geargrid_master.DEVICE_PAIRING_CODES with their tenant_id + user_id.
//   2. Operator types code into phone → claimPairingCode (public).
//   3. Backend looks up code in master, switches to the owning tenant DB,
//      inserts OPERATOR_DEVICES, flips code to CLAIMED.
//   4. Phone polls /pending-signatures (public, by device_id) to discover
//      open signature requests on invoices the operator just dispatched.
// ─────────────────────────────────────────────────────────────────────────

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PENDING_LOOKBACK_MS = 30 * 60 * 1000; // show requests from last 30 min

// FUTURE (super admin setting): Android app minimum and latest supported versions stored in
// master DB PLATFORM_CONFIG (`min_app_version`, `latest_app_version`), falling back to 1.0.0.
// See revampedBackend_Geargrid/docs/FUTURE_SETTINGS.md.
export const DEFAULT_MIN_APP_VERSION = "1.0.0";
export const DEFAULT_LATEST_APP_VERSION = "1.0.0";

const parseVersionTuple = (raw) => {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^v/i, "")
    .split("-")[0];
  if (!cleaned) return null;
  const parts = cleaned.split(".").map((seg) => {
    const m = /^(\d+)/.exec(seg.trim());
    return m ? Number(m[1]) : 0;
  });
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return null;
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
};

export const compareAppVersions = (vA, vB) => {
  const a = parseVersionTuple(vA);
  const b = parseVersionTuple(vB);
  if (!a || !b) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
};

export const evaluateDeviceAppVersion = (
  appVersion,
  {
    min_app_version = DEFAULT_MIN_APP_VERSION,
    latest_app_version = DEFAULT_LATEST_APP_VERSION,
  } = {},
) => {
  if (!appVersion || !String(appVersion).trim()) return "unknown";
  if (compareAppVersions(appVersion, min_app_version) < 0) return "update_required";
  if (compareAppVersions(appVersion, latest_app_version) < 0) return "update_available";
  return "up_to_date";
};

export const getAppVersionConfig = async (masterModelsOverride = null) => {
  let minVersion = DEFAULT_MIN_APP_VERSION;
  let latestVersion = DEFAULT_LATEST_APP_VERSION;
  try {
    const mm = masterModelsOverride || getMasterModels();
    const PlatformConfig = mm?.PlatformConfig;
    if (!PlatformConfig?.findByPk) {
      return { min_app_version: minVersion, latest_app_version: latestVersion };
    }
    const [minRow, latestRow] = await Promise.all([
      PlatformConfig.findByPk("min_app_version"),
      PlatformConfig.findByPk("latest_app_version"),
    ]);
    const parsedMin = parseJsonField(minRow?.config_value, minRow?.config_value ?? null);
    const parsedLatest = parseJsonField(
      latestRow?.config_value,
      latestRow?.config_value ?? null,
    );
    if (typeof parsedMin === "string" && parsedMin.trim()) {
      minVersion = parsedMin.trim();
    }
    if (typeof parsedLatest === "string" && parsedLatest.trim()) {
      latestVersion = parsedLatest.trim();
    }
  } catch {
    // Master models not initialized or table unavailable: return defaults safely
  }
  return {
    min_app_version: minVersion,
    latest_app_version: latestVersion,
  };
};

// Readable, ambiguous-free alphabet. No 0/O, 1/I/L.
// (Previously included `L` by mistake, which collides with 1/I visually and
// tripped the "no ambiguous chars" unit test flakily.)
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const nowUtc = () => new Date();

const mintCode = () => {
  const pickChar = () => ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${pickChar()}${pickChar()}${pickChar()}-${pickChar()}${pickChar()}${pickChar()}`;
};

const sanitizeCode = (raw) =>
  String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");

export const hashDeviceToken = (rawToken) =>
  crypto.createHash("sha256").update(String(rawToken)).digest("hex");

const safeTimingEqualHex = (rawToken, expectedHashHex) => {
  if (!rawToken || !expectedHashHex || typeof expectedHashHex !== "string") return false;
  if (!/^[a-f0-9]{64}$/i.test(expectedHashHex)) return false;
  const presentedHex = hashDeviceToken(rawToken);
  const a = Buffer.from(presentedHex.toLowerCase(), "utf8");
  const b = Buffer.from(expectedHashHex.toLowerCase(), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const matchesDeviceToken = (rawToken, device, nowMs = Date.now()) => {
  if (!rawToken || !device) return false;
  if (safeTimingEqualHex(rawToken, device.token_hash)) return true;
  if (
    device.prev_token_hash &&
    device.prev_token_expires_at &&
    new Date(device.prev_token_expires_at).getTime() > nowMs &&
    safeTimingEqualHex(rawToken, device.prev_token_hash)
  ) {
    return true;
  }
  return false;
};

export const writeDeviceAudit = async (
  models,
  { operatorDeviceId, actorUserId = null, action, detail = null },
) => {
  if (!models?.DeviceAuditLog?.create || !operatorDeviceId || !action) return null;
  try {
    return await models.DeviceAuditLog.create({
      operator_device_id: operatorDeviceId,
      actor_user_id: actorUserId,
      action,
      detail,
    });
  } catch {
    return null;
  }
};

// ── Authenticated side (operator on POS) ────────────────────────────────

export const mintPairingCode = async (
  masterModels,
  { tenant_id, user_id, requested_capabilities = null },
) => {
  // Garbage-collect this operator's own stale PENDING codes before minting
  // a fresh one — keeps the table tidy and prevents multiple active codes.
  await masterModels.DevicePairingCode.update(
    { status: "EXPIRED" },
    {
      where: {
        user_id,
        tenant_id,
        status: "PENDING",
      },
    },
  );

  // Mint a unique code (retry on the rare collision).
  let code;
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = mintCode();
    const taken = await masterModels.DevicePairingCode.findOne({
      where: { code: candidate, status: "PENDING" },
    });
    if (!taken) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new AppError("Could not mint a unique pairing code — retry.", 500);

  const normalizedRequested = requested_capabilities
    ? normalizeCapabilitiesMap(requested_capabilities, DEFAULT_CAPABILITIES_MAP)
    : null;
  const expires_at = new Date(nowUtc().getTime() + PAIRING_CODE_TTL_MS);
  await masterModels.DevicePairingCode.create({
    code,
    tenant_id,
    user_id,
    status: "PENDING",
    expires_at,
    ...(normalizedRequested ? { requested_capabilities: normalizedRequested } : {}),
  });

  return {
    code,
    expires_at,
    ...(normalizedRequested ? { requested_capabilities: normalizedRequested } : {}),
  };
};

export const listMyDevices = async (tenantModels, userId, tenantDbName = null) => {
  const rows = await tenantModels.OperatorDevice.findAll({
    where: {
      user_id: userId,
      status: { [Op.ne]: "REVOKED" },
    },
    order: [["paired_at", "DESC"]],
  });
  const activeRows = (rows || []).filter((r) => (r.status || "ACTIVE") !== "REVOKED");

  const contactCountByDevice = new Map();
  if (tenantModels.PhoneContact && activeRows.length > 0 && tenantModels.sequelize?.fn) {
    try {
      const counts = await tenantModels.PhoneContact.findAll({
        where: { operator_device_id: { [Op.in]: activeRows.map((r) => r.operator_device_id) } },
        attributes: [
          "operator_device_id",
          [tenantModels.sequelize.fn("COUNT", tenantModels.sequelize.col("contact_id")), "cnt"],
        ],
        group: ["operator_device_id"],
        raw: true,
      });
      for (const c of counts || []) {
        contactCountByDevice.set(Number(c.operator_device_id), Number(c.cnt) || 0);
      }
    } catch {
      // Optional enrichment if PhoneContact table isn't initialized in unit mock
    }
  }

  let policy = null;
  let userCtx = null;
  let planHasPa = true;
  if (activeRows.length > 0 && tenantModels.TenantConfig) {
    try {
      ({ policy } = await getPhoneAssistantPolicy(tenantModels));
      userCtx = await loadUserCapabilitiesContext(tenantModels, userId);
      if (tenantDbName) {
        const plan = await getTenantPlan(tenantDbName);
        planHasPa = plan?.features?.phone_assistant !== false;
      }
    } catch {
      // Optional enrichment in partial unit mocks
    }
  }

  return {
    devices: activeRows.map((r) => {
      const caps = policy
        ? resolveDeviceCapabilities({
            device: r,
            isAdmin: userCtx?.isAdmin ?? false,
            permissionSet: userCtx?.permissionSet ?? new Set(),
            policy,
            planHasPhoneAssistant: planHasPa,
          }).effective
        : undefined;
      return {
        operator_device_id: r.operator_device_id,
        device_id: r.device_id,
        device_label: r.device_label,
        user_agent: r.user_agent,
        paired_at: r.paired_at,
        last_seen_at: r.last_seen_at,
        status: r.status || "ACTIVE",
        device_model: r.device_model ?? null,
        os_version: r.os_version ?? null,
        ...(caps ? { effective_capabilities: caps } : {}),
        is_native_app: Boolean(r.is_native_app),
        app_version: r.app_version ?? null,
        contact_sync_enabled: Boolean(r.contact_sync_enabled),
        contact_count: contactCountByDevice.get(Number(r.operator_device_id)) ?? 0,
        contacts_synced_at: r.contacts_synced_at ?? null,
        briefs_synced_at: r.briefs_synced_at ?? null,
      };
    }),
  };
};

const revokeDeviceRow = async (
  tenantModels,
  masterModels,
  device,
  { actorUserId = null, action = "revoked", detail = null } = {},
) => {
  const savedPushToken = device.push_token;
  const savedDeviceId = device.device_id;

  if (tenantModels?.PhoneContact?.destroy) {
    await tenantModels.PhoneContact.destroy({
      where: { operator_device_id: device.operator_device_id },
    });
  }
  if (masterModels?.DeviceRegistry?.destroy) {
    await masterModels.DeviceRegistry.destroy({ where: { device_id: savedDeviceId } }).catch(
      () => {},
    );
  }

  const now = nowUtc();
  if (typeof device.update === "function") {
    await device.update({
      status: "REVOKED",
      revoked_at: now,
      token_hash: null,
      prev_token_hash: null,
      prev_token_expires_at: null,
      push_token: null,
      push_token_updated_at: now,
      contact_sync_enabled: false,
      contact_sync_mode: "off",
      briefs_synced_at: null,
    });
  } else if (typeof device.destroy === "function") {
    await device.destroy();
  }

  await writeDeviceAudit(tenantModels, {
    operatorDeviceId: device.operator_device_id,
    actorUserId,
    action,
    detail,
  });

  // The same phone may already be paired again under a new device id with the same push token.
  // Telling it "device_revoked" then would wipe that new pairing, so only push when no other live
  // pairing uses this token.
  if (savedPushToken) {
    const sharedWithLivePairing = tenantModels?.OperatorDevice?.findOne
      ? await tenantModels.OperatorDevice.findOne({
          where: {
            push_token: savedPushToken,
            operator_device_id: { [Op.ne]: device.operator_device_id },
            status: { [Op.ne]: "REVOKED" },
          },
          attributes: ["operator_device_id"],
        }).catch(() => null)
      : null;
    if (!sharedWithLivePairing) {
      await sendDataPush(
        { push_token: savedPushToken, device_id: savedDeviceId },
        { type: "device_revoked" },
      ).catch(() => {});
    }
  }
};

export const unpairDevice = async (tenantModels, operatorDeviceId, userId, masterModels = null) => {
  const row = await tenantModels.OperatorDevice.findOne({
    where: { operator_device_id: operatorDeviceId, user_id: userId },
  });
  if (!row || row.status === "REVOKED") return { unpaired: false };
  await revokeDeviceRow(tenantModels, masterModels, row, {
    actorUserId: userId,
    action: "revoked",
    detail: { reason: "unpaired_by_operator" },
  });
  return { unpaired: true };
};

/** Self-unpair the currently authenticated phone (A-06 / B.4). */
export const unpairCurrentDevice = async (tenantModels, masterModels, device) => {
  if (!device || device.status === "REVOKED") return { unpaired: false };
  await revokeDeviceRow(tenantModels, masterModels, device, {
    actorUserId: device.user_id,
    action: "unpaired_by_phone",
    detail: { reason: "unpaired_by_phone" },
  });
  return { unpaired: true };
};

const warnedLegacyPublicAccess = new Set();

const upsertDeviceRegistry = async (masterModels, device_id, tenant_id) => {
  const registry = masterModels?.DeviceRegistry;
  if (!registry || !tenant_id) return;
  try {
    if (typeof registry.upsert === "function") {
      await registry.upsert({ device_id, tenant_id: String(tenant_id) });
      return;
    }
    const existingReg = typeof registry.findByPk === "function"
      ? await registry.findByPk(device_id)
      : await registry.findOne?.({ where: { device_id } });
    if (existingReg?.update) {
      await existingReg.update({ tenant_id: String(tenant_id) });
    } else if (typeof registry.create === "function") {
      await registry.create({ device_id, tenant_id: String(tenant_id) });
    }
  } catch {
    // Registry write is best-effort for legacy mocks
  }
};

// ── Public side (phone) ─────────────────────────────────────────────────

export const getPairingCodePreview = async (masterModels, { code }) => {
  const normalizedCode = sanitizeCode(code);
  if (!normalizedCode) throw new AppError("Pairing code is required.", 400);

  const row = await masterModels.DevicePairingCode.findOne({
    where: { code: normalizedCode, status: "PENDING" },
  });
  if (!row) throw new AppError("Pairing code not found. Ask the POS to generate a fresh one.", 404);

  if (new Date(row.expires_at).getTime() < nowUtc().getTime()) {
    await row.update({ status: "EXPIRED" });
    throw new AppError("Pairing code expired. Ask the POS to generate a new one.", 410);
  }

  const tenant = await masterModels.Tenant.findByPk(row.tenant_id);
  if (!tenant) throw new AppError("Tenant for this code is unavailable.", 404);
  if (isTenantShopInactive(tenant)) {
    throw new AppError("Shop subscription is currently inactive.", 403, "shop_inactive");
  }

  const tenantConnection = getCachedTenantConnection(tenant.db_name);
  const tenantModels = initTenantModels(tenantConnection);

  const [{ policy }, userCtx, tenantConfig] = await Promise.all([
    getPhoneAssistantPolicy(tenantModels),
    loadUserCapabilitiesContext(tenantModels, row.user_id),
    tenantModels.TenantConfig?.findOne ? tenantModels.TenantConfig.findOne() : null,
  ]);

  const user = userCtx.user;
  const staffName =
    `${user?.first_name || ""} ${user?.last_name || ""}`.trim() ||
    user?.username ||
    user?.email ||
    "Staff Member";

  const requestedBase = normalizeCapabilitiesMap(
    row.requested_capabilities,
    policy.capabilities,
  );
  const effectiveRequested = {};
  for (const key of DEVICE_CAPABILITY_KEYS) {
    effectiveRequested[key] =
      Boolean(policy.capabilities[key]) && Boolean(requestedBase[key]);
  }

  const willRequireApproval =
    policy.approval_mode === "admin_approves_all" ||
    (policy.approval_mode === "auto_approve_admin_phones" && !userCtx.isAdmin);

  return {
    code: row.code,
    shop_name: tenantConfig?.business_display_name || tenant.display_name || "GearGrid",
    staff_name: staffName,
    expires_at: new Date(row.expires_at).toISOString(),
    requested_capabilities: effectiveRequested,
    approval_mode: policy.approval_mode,
    will_require_approval: willRequireApproval,
  };
};

export const claimPairingCode = async (
  masterModels,
  {
    code,
    device_id,
    device_label,
    user_agent,
    device_model = null,
    os_version = null,
    app_version = null,
    consented_capabilities = null,
  },
) => {
  const normalizedCode = sanitizeCode(code);
  if (!normalizedCode) throw new AppError("Pairing code is required.", 400);
  if (!device_id || device_id.length < 8) {
    throw new AppError("device_id is required.", 400);
  }

  const row = await masterModels.DevicePairingCode.findOne({
    where: { code: normalizedCode, status: "PENDING" },
  });
  if (!row) throw new AppError("Pairing code not found. Ask the POS to generate a fresh one.", 404);

  if (new Date(row.expires_at).getTime() < nowUtc().getTime()) {
    await row.update({ status: "EXPIRED" });
    throw new AppError("Pairing code expired. Ask the POS to generate a new one.", 410);
  }

  // Resolve the owning tenant's db_name from the master Tenant row.
  const tenant = await masterModels.Tenant.findByPk(row.tenant_id);
  if (!tenant) throw new AppError("Tenant for this code is unavailable.", 404);

  // A-14: If DEVICE_REGISTRY points to another shop, clean up the old shop's device & contacts first.
  const registry = masterModels.DeviceRegistry;
  const regEntry = registry
    ? typeof registry.findOne === "function"
      ? await registry.findOne({ where: { device_id } })
      : await registry.findByPk?.(device_id)
    : null;
  if (regEntry && String(regEntry.tenant_id) !== String(tenant.tenant_id)) {
    const oldTenant = await masterModels.Tenant.findByPk(regEntry.tenant_id);
    if (oldTenant?.db_name) {
      try {
        const oldConn = getCachedTenantConnection(oldTenant.db_name);
        const oldModels = initTenantModels(oldConn);
        const oldDevice = await oldModels.OperatorDevice?.findOne({ where: { device_id } });
        if (oldDevice) {
          if (oldModels.PhoneContact?.destroy) {
            await oldModels.PhoneContact.destroy({
              where: { operator_device_id: oldDevice.operator_device_id },
            });
          }
          await oldDevice.destroy();
        }
      } catch {
        // Old tenant DB unreachable; continue provisioning new shop pairing
      }
    }
  }

  // Connect to the owning tenant DB and create / refresh OperatorDevice.
  const tenantConnection = getCachedTenantConnection(tenant.db_name);
  const tenantModels = initTenantModels(tenantConnection);

  // Load shop policy & user role context to determine PENDING vs ACTIVE on pair (B.1).
  let policy = {
    approval_mode: "auto_approve_admin_phones",
    auto_suspend_days: 30,
    offline_wipe_days: 7,
    capabilities: { ...DEFAULT_CAPABILITIES_MAP },
  };
  let userCtx = { user: null, isAdmin: false, permissionSet: new Set() };
  try {
    ({ policy } = await getPhoneAssistantPolicy(tenantModels));
    userCtx = await loadUserCapabilitiesContext(tenantModels, row.user_id);
  } catch {
    // Minimal mocks without TenantConfig / Role fall back cleanly
  }

  const initialStatus =
    policy.approval_mode === "auto_approve_all" ||
    (policy.approval_mode === "auto_approve_admin_phones" && userCtx.isAdmin)
      ? "ACTIVE"
      : "PENDING";

  const requestedCaps = row.requested_capabilities
    ? normalizeCapabilitiesMap(row.requested_capabilities, policy.capabilities)
    : normalizeCapabilitiesMap(policy.capabilities, DEFAULT_CAPABILITIES_MAP);
  const initialCapabilities = { ...requestedCaps };
  if (consented_capabilities && typeof consented_capabilities === "object") {
    for (const key of DEVICE_CAPABILITY_KEYS) {
      if (typeof consented_capabilities[key] === "boolean") {
        initialCapabilities[key] = initialCapabilities[key] && consented_capabilities[key];
      }
    }
  }

  // Generate 32-byte credential for native/PWA authenticated endpoints; store only its SHA-256 hash.
  const deviceToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashDeviceToken(deviceToken);
  const now = nowUtc();
  const safeModel = device_model ? String(device_model).trim().slice(0, 100) : null;
  const safeOs = os_version ? String(os_version).trim().slice(0, 20) : null;
  const safeApp = app_version ? String(app_version).trim().slice(0, 20) : null;

  // If this device_id was previously paired (e.g. same phone re-pairing),
  // flip it to the new operator rather than erroring out.
  // A-13: If re-pairing to a different user inside the same shop, wipe synced contacts & reset sync/push state.
  const existing = await tenantModels.OperatorDevice.findOne({ where: { device_id } });
  let devicePaired;
  if (existing) {
    const userChanged = Number(existing.user_id) !== Number(row.user_id);
    if ((userChanged || existing.status === "REVOKED") && tenantModels.PhoneContact?.destroy) {
      await tenantModels.PhoneContact.destroy({
        where: { operator_device_id: existing.operator_device_id },
      });
    }
    await existing.update({
      user_id: row.user_id,
      device_label: device_label?.slice(0, 100) || existing.device_label,
      user_agent: user_agent?.slice(0, 500) || existing.user_agent,
      ...(safeModel ? { device_model: safeModel } : {}),
      ...(safeOs ? { os_version: safeOs } : {}),
      ...(safeApp ? { app_version: safeApp, is_native_app: true } : {}),
      status: initialStatus,
      capabilities: initialCapabilities,
      approved_by: initialStatus === "ACTIVE" ? row.user_id : null,
      approved_at: initialStatus === "ACTIVE" ? now : null,
      revoked_at: null,
      prev_token_hash: null,
      prev_token_expires_at: null,
      token_hash: tokenHash,
      token_issued_at: now,
      paired_at: now,
      last_seen_at: now,
      ...(userChanged || existing.status === "REVOKED"
        ? {
            contact_sync_enabled: false,
            contact_sync_mode: "off",
            push_token: null,
            push_token_updated_at: null,
            contacts_synced_at: null,
            briefs_synced_at: null,
          }
        : {}),
    });
    devicePaired = existing;
  } else {
    devicePaired = await tenantModels.OperatorDevice.create({
      user_id: row.user_id,
      device_id,
      device_label: device_label?.slice(0, 100) || null,
      user_agent: user_agent?.slice(0, 500) || null,
      device_model: safeModel,
      os_version: safeOs,
      ...(safeApp ? { app_version: safeApp, is_native_app: true } : {}),
      status: initialStatus,
      capabilities: initialCapabilities,
      contact_sync_mode: "off",
      approved_by: initialStatus === "ACTIVE" ? row.user_id : null,
      approved_at: initialStatus === "ACTIVE" ? now : null,
      token_hash: tokenHash,
      token_issued_at: now,
      paired_at: now,
      last_seen_at: now,
    });
  }

  await upsertDeviceRegistry(masterModels, device_id, tenant.tenant_id);

  await row.update({
    status: "CLAIMED",
    claimed_device_id: device_id,
    claimed_at: nowUtc(),
  });

  await writeDeviceAudit(tenantModels, {
    operatorDeviceId: devicePaired.operator_device_id,
    actorUserId: row.user_id,
    action: "paired",
    detail: {
      status: initialStatus,
      device_model: safeModel,
      os_version: safeOs,
      app_version: safeApp,
    },
  });

  if (initialStatus === "PENDING") {
    emitToTenant(tenant.db_name, "device:pending", {
      operator_device_id: devicePaired.operator_device_id,
      user_id: row.user_id,
      device_label: devicePaired.device_label ?? null,
    });
  }

  // Package tenant branding + operator details so the phone can render its
  // "paired to Jane at ABC Rentals" home screen in one round-trip.
  const tenantConfig = await tenantModels.TenantConfig.findOne();
  const user = await tenantModels.User.findByPk(row.user_id, {
    attributes: ["user_id", "first_name", "last_name", "username", "signature_url"],
  });
  const operatorName =
    `${user?.first_name || ""} ${user?.last_name || ""}`.trim() ||
    user?.username ||
    "Operator";

  const { effective: effectiveCapabilities } = resolveDeviceCapabilities({
    device: { ...devicePaired, status: initialStatus, capabilities: initialCapabilities },
    isAdmin: userCtx.isAdmin,
    permissionSet: userCtx.permissionSet,
    policy,
    planHasPhoneAssistant: true,
  });

  return {
    operator_device_id: devicePaired.operator_device_id,
    device_id,
    tenant_db_name: tenant.db_name,
    device_token: deviceToken,
    status: initialStatus,
    effective_capabilities: effectiveCapabilities,
    operator: {
      user_id: user?.user_id,
      operator_name: operatorName,
      has_saved_signature: !!user?.signature_url,
    },
    tenant: {
      business_display_name: tenantConfig?.business_display_name || tenant.display_name || "GearGrid",
      logo_url: tenantConfig?.logo_url || null,
      primary_color: tenantConfig?.primary_color || "#1976d2",
      secondary_color: tenantConfig?.secondary_color || "#9c27b0",
    },
    paired_at: devicePaired.paired_at,
  };
};

/**
 * Native app start / push token / contact-sync switch heartbeat.
 * Sets is_native_app=true, updates app_version/push_token/contact_sync_enabled,
 * deletes PHONE_CONTACTS when contact_sync_enabled is switched off, enforces
 * auto_suspend_days, and returns role, plan, and effective capabilities.
 */
export const registerDevice = async (
  tenantModels,
  tenantDbName,
  device,
  {
    app_version,
    push_token,
    contact_sync_enabled,
    device_model,
    os_version,
    reported_state,
    click_to_call_enabled,
    cached_briefs,
    brief_format,
    outbox_pending,
    last_brief_sync_at,
    last_contact_sync_at,
  } = {},
) => {
  const now = nowUtc();
  const { policy } = await getPhoneAssistantPolicy(tenantModels);

  if (
    policy.auto_suspend_days > 0 &&
    (device.status || "ACTIVE") === "ACTIVE" &&
    device.last_seen_at
  ) {
    const idleMs = now.getTime() - new Date(device.last_seen_at).getTime();
    if (idleMs > policy.auto_suspend_days * 24 * 60 * 60 * 1000) {
      await setDeviceStatus(
        tenantModels,
        device.operator_device_id,
        "SUSPENDED",
        null,
        "auto_suspend_inactive",
      );
      throw new AppError(
        "Device has been suspended due to inactivity.",
        403,
        "device_suspended",
      );
    }
  }

  const prevSyncEnabled = Boolean(device.contact_sync_enabled);
  const patch = {
    is_native_app: true,
    last_seen_at: now,
  };
  if (app_version !== undefined && app_version !== null) {
    patch.app_version = String(app_version).slice(0, 20);
  }
  if (device_model !== undefined && device_model !== null) {
    patch.device_model = String(device_model).trim().slice(0, 100) || null;
  }
  if (os_version !== undefined && os_version !== null) {
    patch.os_version = String(os_version).trim().slice(0, 20) || null;
  }
  if (
    reported_state !== undefined ||
    typeof click_to_call_enabled === "boolean" ||
    cached_briefs !== undefined ||
    outbox_pending !== undefined ||
    last_brief_sync_at !== undefined ||
    last_contact_sync_at !== undefined ||
    brief_format !== undefined
  ) {
    const prevState = parseJsonField(device.reported_state, {});
    const mergedState = {
      ...(prevState && typeof prevState === "object" ? prevState : {}),
      ...(reported_state && typeof reported_state === "object" ? reported_state : {}),
      ...(typeof click_to_call_enabled === "boolean" ? { click_to_call_enabled } : {}),
      ...(Number.isInteger(cached_briefs) && cached_briefs >= 0 ? { cached_briefs } : {}),
      ...(Number.isInteger(brief_format) && brief_format >= 1 ? { brief_format } : {}),
      ...(Number.isInteger(outbox_pending) && outbox_pending >= 0 ? { outbox_pending } : {}),
      ...(last_brief_sync_at ? { last_brief_sync_at: String(last_brief_sync_at) } : {}),
      ...(last_contact_sync_at ? { last_contact_sync_at: String(last_contact_sync_at) } : {}),
    };
    patch.reported_state = mergedState;
  }
  if (push_token !== undefined) {
    if (push_token !== null && String(push_token).length > 512) {
      throw new AppError("push_token exceeds maximum length of 512 characters.", 400);
    }
    patch.push_token = push_token ? String(push_token) : null;
    patch.push_token_updated_at = push_token ? now : null;
  }
  if (typeof contact_sync_enabled === "boolean") {
    patch.contact_sync_enabled = contact_sync_enabled;
    if (contact_sync_enabled && (!device.contact_sync_mode || device.contact_sync_mode === "off")) {
      patch.contact_sync_mode = "all";
    } else if (!contact_sync_enabled) {
      patch.contact_sync_mode = "off";
    }
  }

  await device.update(patch);

  if (typeof contact_sync_enabled === "boolean" && contact_sync_enabled !== prevSyncEnabled) {
    await writeDeviceAudit(tenantModels, {
      operatorDeviceId: device.operator_device_id,
      actorUserId: device.user_id,
      action: contact_sync_enabled ? "contact_sync_on" : "contact_sync_off",
      detail: { source: "device_register" },
    });
  }

  if (contact_sync_enabled === false && tenantModels.PhoneContact) {
    await tenantModels.PhoneContact.destroy({
      where: { operator_device_id: device.operator_device_id },
    });
  }

  const userCtx = await loadUserCapabilitiesContext(tenantModels, device.user_id);
  const plan = await getTenantPlan(tenantDbName);
  const features = {
    ...(plan?.features || {}),
    phone_assistant: plan?.features?.phone_assistant !== false,
  };

  const { effective, reasons } = resolveDeviceCapabilities({
    device,
    isAdmin: userCtx.isAdmin,
    permissionSet: userCtx.permissionSet,
    policy,
    planHasPhoneAssistant: features.phone_assistant,
    userActive: userCtx.user ? userCtx.user.is_active !== false : true,
  });

  return {
    is_admin: userCtx.isAdmin,
    contact_sync_enabled: Boolean(device.contact_sync_enabled),
    device_status: device.status || "ACTIVE",
    effective_capabilities: effective,
    capability_reasons: reasons,
    offline_wipe_days: policy.offline_wipe_days,
    features,
  };
};

/**
 * Rotate the device bearer token while keeping the previous token valid for a 24h
 * grace window (B.5) so in-flight requests or app restarts never lock the phone out.
 */
export const rotateDeviceToken = async (tenantModels, device, now = nowUtc()) => {
  if (!device || device.status === "REVOKED") {
    throw new AppError("Device authentication failed. Please pair this phone again.", 401, "device_revoked");
  }
  const rawToken = crypto.randomBytes(32).toString("hex");
  const newHash = hashDeviceToken(rawToken);
  const graceExpires = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  await device.update({
    prev_token_hash: device.token_hash || null,
    prev_token_expires_at: device.token_hash ? graceExpires : null,
    token_hash: newHash,
    token_issued_at: now,
    last_seen_at: now,
  });

  await writeDeviceAudit(tenantModels, {
    operatorDeviceId: device.operator_device_id,
    actorUserId: device.user_id,
    action: "token_rotated",
    detail: { prev_grace_until: graceExpires.toISOString() },
  });

  return {
    device_token: rawToken,
    expires_in_days: 30,
  };
};

const formatShopDevice = async (
  tenantModels,
  device,
  {
    policy,
    planHasPhoneAssistant = true,
    contactCountMap = null,
    callCountMap = null,
    versionConfig = null,
  } = {},
) => {
  const userCtx = await loadUserCapabilitiesContext(
    tenantModels,
    device.User || device.user_id,
  );
  const user = device.User || userCtx.user;
  const staffName =
    `${user?.first_name || ""} ${user?.last_name || ""}`.trim() ||
    user?.username ||
    user?.email ||
    `Staff #${device.user_id}`;
  const roles = Array.isArray(user?.Roles) ? user.Roles.filter((r) => r?.is_active !== false) : [];
  const primaryRoleName =
    roles.sort((a, b) => Number(b.hierarchy_level || 0) - Number(a.hierarchy_level || 0))[0]
      ?.role_name || null;

  const { granted, effective, reasons } = resolveDeviceCapabilities({
    device,
    isAdmin: userCtx.isAdmin,
    permissionSet: userCtx.permissionSet,
    policy,
    planHasPhoneAssistant,
    userActive: user ? user.is_active !== false : true,
  });

  const resolvedVersionConfig = versionConfig || {
    min_app_version: DEFAULT_MIN_APP_VERSION,
    latest_app_version: DEFAULT_LATEST_APP_VERSION,
  };
  const versionStatus = evaluateDeviceAppVersion(device.app_version, resolvedVersionConfig);
  const healthWarnings = [
    ...computeDeviceHealthWarnings(device, Date.now(), policy?.sync?.warn_after_hours),
  ];
  if (
    (versionStatus === "update_required" || versionStatus === "update_available") &&
    !healthWarnings.includes(versionStatus)
  ) {
    healthWarnings.push(versionStatus);
  }

  return {
    operator_device_id: Number(device.operator_device_id),
    user_id: Number(device.user_id),
    staff_name: staffName,
    staff_email: user?.email ?? null,
    staff_role_name: primaryRoleName,
    staff_is_admin: userCtx.isAdmin,
    device_id: device.device_id,
    device_label: device.device_label ?? null,
    device_model: device.device_model ?? null,
    os_version: device.os_version ?? null,
    app_version: device.app_version ?? null,
    is_native_app: Boolean(device.is_native_app),
    status: device.status || "ACTIVE",
    paired_at: device.paired_at ? new Date(device.paired_at).toISOString() : new Date().toISOString(),
    last_seen_at: device.last_seen_at ? new Date(device.last_seen_at).toISOString() : null,
    approved_by: device.approved_by ?? null,
    approved_at: device.approved_at ? new Date(device.approved_at).toISOString() : null,
    revoked_at: device.revoked_at ? new Date(device.revoked_at).toISOString() : null,
    muted: Boolean(device.muted),
    brief_profile_id: device.brief_profile_id ?? null,
    contact_sync_enabled: Boolean(device.contact_sync_enabled),
    contact_sync_mode: device.contact_sync_mode || (device.contact_sync_enabled ? "all" : "off"),
    contacts_synced_at: device.contacts_synced_at
      ? new Date(device.contacts_synced_at).toISOString()
      : null,
    contact_count: contactCountMap
      ? contactCountMap.get(Number(device.operator_device_id)) ?? 0
      : 0,
    call_logging_scope: device.call_logging_scope || "customers_and_contacts",
    calls_logged_count: callCountMap
      ? callCountMap.get(Number(device.operator_device_id)) ?? 0
      : 0,
    sim_filter: device.sim_filter ?? null,
    capabilities: granted,
    effective_capabilities: effective,
    capability_reasons: reasons,
    briefs_synced_at: device.briefs_synced_at ? new Date(device.briefs_synced_at).toISOString() : null,
    reported_state: parseJsonField(device.reported_state, null),
    health_warnings: healthWarnings,
    version_status: versionStatus,
  };
};

export const listShopDevices = async (
  tenantModels,
  tenantDbName = null,
  { status } = {},
  masterModelsOverride = null,
) => {
  const roleInclude = tenantModels.Role
    ? [
        {
          model: tenantModels.Role,
          attributes: ["role_id", "role_name", "hierarchy_level", "is_active"],
          through: { attributes: [] },
          ...(tenantModels.Permission
            ? {
                include: [
                  {
                    model: tenantModels.Permission,
                    attributes: ["permission_code"],
                    through: { attributes: [] },
                  },
                ],
              }
            : {}),
        },
      ]
    : [];

  const allRows = await tenantModels.OperatorDevice.findAll({
    include: tenantModels.User
      ? [
          {
            model: tenantModels.User,
            attributes: ["user_id", "first_name", "last_name", "username", "email", "is_active"],
            ...(roleInclude.length > 0 ? { include: roleInclude } : {}),
          },
        ]
      : [],
    order: [["paired_at", "DESC"]],
  });

  const counts = {
    total: allRows.length,
    pending: 0,
    active: 0,
    suspended: 0,
    revoked: 0,
  };
  for (const r of allRows) {
    const st = r.status || "ACTIVE";
    if (st === "PENDING") counts.pending += 1;
    else if (st === "ACTIVE") counts.active += 1;
    else if (st === "SUSPENDED") counts.suspended += 1;
    else if (st === "REVOKED") counts.revoked += 1;
  }

  const filtered = status
    ? allRows.filter((r) => (r.status || "ACTIVE") === String(status).toUpperCase())
    : allRows;

  const deviceIds = filtered.map((r) => r.operator_device_id);
  const contactCountMap = new Map();
  const callCountMap = new Map();

  if (deviceIds.length > 0 && tenantModels.sequelize?.fn) {
    if (tenantModels.PhoneContact?.findAll) {
      try {
        const contactCounts = await tenantModels.PhoneContact.findAll({
          where: { operator_device_id: { [Op.in]: deviceIds } },
          attributes: [
            "operator_device_id",
            [tenantModels.sequelize.fn("COUNT", tenantModels.sequelize.col("contact_id")), "cnt"],
          ],
          group: ["operator_device_id"],
          raw: true,
        });
        for (const c of contactCounts || []) {
          contactCountMap.set(Number(c.operator_device_id), Number(c.cnt) || 0);
        }
      } catch {
        // Ignore mock SQL errors
      }
    }
    if (tenantModels.CallLog?.findAll) {
      try {
        const callCounts = await tenantModels.CallLog.findAll({
          where: { operator_device_id: { [Op.in]: deviceIds } },
          attributes: [
            "operator_device_id",
            [tenantModels.sequelize.fn("COUNT", tenantModels.sequelize.col("call_id")), "cnt"],
          ],
          group: ["operator_device_id"],
          raw: true,
        });
        for (const c of callCounts || []) {
          callCountMap.set(Number(c.operator_device_id), Number(c.cnt) || 0);
        }
      } catch {
        // Ignore mock SQL errors
      }
    }
  }

  const [{ policy }, plan, versionConfig] = await Promise.all([
    getPhoneAssistantPolicy(tenantModels),
    tenantDbName ? getTenantPlan(tenantDbName) : Promise.resolve(null),
    getAppVersionConfig(masterModelsOverride),
  ]);
  const planHasPhoneAssistant = plan?.features?.phone_assistant !== false;

  const devices = [];
  for (const row of filtered) {
    devices.push(
      await formatShopDevice(tenantModels, row, {
        policy,
        planHasPhoneAssistant,
        contactCountMap,
        callCountMap,
        versionConfig,
      }),
    );
  }

  return {
    devices,
    counts,
    min_app_version: versionConfig.min_app_version,
    latest_app_version: versionConfig.latest_app_version,
  };
};

export const setDeviceStatus = async (
  tenantModels,
  deviceId,
  nextStatus,
  actorUser = null,
  reason = null,
  masterModels = null,
) => {
  const device = await tenantModels.OperatorDevice.findByPk(deviceId);
  if (!device) {
    throw new AppError("Device not found.", 404);
  }

  const prevStatus = device.status || "ACTIVE";
  const target = String(nextStatus || "").toUpperCase();
  if (!["PENDING", "ACTIVE", "SUSPENDED", "REVOKED"].includes(target)) {
    throw new AppError("Invalid device status.", 400);
  }
  if (prevStatus === "REVOKED" && target !== "REVOKED") {
    throw new AppError("Revoked devices cannot be reactivated; please pair the phone again.", 400);
  }

  const actorUserId =
    typeof actorUser === "object" && actorUser
      ? actorUser.userId ?? actorUser.user_id ?? actorUser.id ?? null
      : typeof actorUser === "number"
        ? actorUser
        : null;

  if (target === "REVOKED") {
    await revokeDeviceRow(tenantModels, masterModels, device, {
      actorUserId,
      action: "revoked",
      detail: { reason: reason || null, previous_status: prevStatus },
    });
  } else if (target === "SUSPENDED") {
    await device.update({ status: "SUSPENDED", briefs_synced_at: null });
    await writeDeviceAudit(tenantModels, {
      operatorDeviceId: device.operator_device_id,
      actorUserId,
      action: "suspended",
      detail: { reason: reason || null, previous_status: prevStatus },
    });
    if (device.push_token) {
      await sendDataPush(device, { type: "device_suspended" }).catch(() => {});
    }
  } else if (target === "ACTIVE") {
    const action = prevStatus === "SUSPENDED" ? "resumed" : "approved";
    await device.update({
      status: "ACTIVE",
      approved_by: actorUserId || device.approved_by || null,
      approved_at: new Date(),
    });
    await writeDeviceAudit(tenantModels, {
      operatorDeviceId: device.operator_device_id,
      actorUserId,
      action,
      detail: { reason: reason || null, previous_status: prevStatus },
    });
    if (device.push_token) {
      await sendDataPush(device, { type: "device_resumed" }).catch(() => {});
    }
  } else {
    await device.update({ status: "PENDING" });
  }

  const { policy } = await getPhoneAssistantPolicy(tenantModels);
  return { device: await formatShopDevice(tenantModels, device, { policy }) };
};

export const updateShopDevice = async (
  tenantModels,
  deviceId,
  patch = {},
  actorUser = null,
) => {
  const device = await tenantModels.OperatorDevice.findByPk(deviceId);
  if (!device) {
    throw new AppError("Device not found.", 404);
  }
  if ((device.status || "ACTIVE") === "REVOKED") {
    throw new AppError("Revoked devices cannot be edited.", 400);
  }

  const actorUserId =
    typeof actorUser === "object" && actorUser
      ? actorUser.userId ?? actorUser.user_id ?? actorUser.id ?? null
      : null;

  const updates = {};
  const auditEvents = [];
  let shouldWipeBriefCache = false;
  let shouldNotifyPolicy = false;

  if (patch.device_label !== undefined) {
    updates.device_label = patch.device_label
      ? String(patch.device_label).trim().slice(0, 100)
      : null;
  }
  if (patch.muted !== undefined) {
    updates.muted = Boolean(patch.muted);
    shouldNotifyPolicy = true;
  }
  if (patch.sim_filter !== undefined) {
    updates.sim_filter = patch.sim_filter ? String(patch.sim_filter).trim().slice(0, 64) : null;
    shouldNotifyPolicy = true;
  }
  if (patch.brief_profile_id !== undefined && patch.brief_profile_id !== device.brief_profile_id) {
    const { policy: currentPolicy } = await getPhoneAssistantPolicy(tenantModels);
    const nextProfileId = patch.brief_profile_id ? String(patch.brief_profile_id).trim() : null;
    if (
      nextProfileId &&
      !(currentPolicy.brief_profiles || []).some((p) => p.id === nextProfileId)
    ) {
      throw new AppError(`Unknown brief profile: ${nextProfileId}`, 400);
    }
    updates.brief_profile_id = nextProfileId;
    updates.briefs_synced_at = null;
    shouldWipeBriefCache = true;
    shouldNotifyPolicy = true;
    auditEvents.push({
      action: "profile_changed",
      detail: { from: device.brief_profile_id || null, to: updates.brief_profile_id },
    });
  }
  if (patch.capabilities && typeof patch.capabilities === "object") {
    const prevCaps = normalizeCapabilitiesMap(device.capabilities, DEFAULT_CAPABILITIES_MAP);
    const nextCaps = { ...prevCaps };
    for (const [k, v] of Object.entries(patch.capabilities)) {
      if (!DEVICE_CAPABILITY_KEYS.includes(k)) {
        throw new AppError(`Unknown capability: ${k}`, 400);
      }
      if (typeof v !== "boolean") {
        throw new AppError(`Capability ${k} must be boolean.`, 400);
      }
      nextCaps[k] = v;
    }
    updates.capabilities = nextCaps;
    shouldNotifyPolicy = true;
    if (prevCaps.caller_brief && !nextCaps.caller_brief) {
      updates.briefs_synced_at = null;
      shouldWipeBriefCache = true;
    }
    auditEvents.push({
      action: "capability_changed",
      detail: { from: prevCaps, to: nextCaps },
    });
  }
  if (patch.contact_sync_mode !== undefined && patch.contact_sync_mode !== device.contact_sync_mode) {
    const { policy: currentPolicy } = await getPhoneAssistantPolicy(tenantModels);
    assertDeviceSettingsWithinPolicy(currentPolicy, {
      contact_sync_mode: patch.contact_sync_mode,
    });
    updates.contact_sync_mode = patch.contact_sync_mode;
    updates.contact_sync_enabled = patch.contact_sync_mode !== "off";
    if (patch.contact_sync_mode === "off") {
      updates.contacts_synced_at = null;
    }
    shouldNotifyPolicy = true;
    auditEvents.push({
      action: patch.contact_sync_mode === "off" ? "contact_sync_off" : "contact_sync_on",
      detail: { mode: patch.contact_sync_mode },
    });
  }
  if (patch.call_logging_scope !== undefined && patch.call_logging_scope !== device.call_logging_scope) {
    const { policy: currentPolicy } = await getPhoneAssistantPolicy(tenantModels);
    assertDeviceSettingsWithinPolicy(currentPolicy, {
      call_logging_scope: patch.call_logging_scope,
    });
    updates.call_logging_scope = patch.call_logging_scope;
    shouldNotifyPolicy = true;
    auditEvents.push({
      action: patch.call_logging_scope === "off" ? "call_logging_off" : "call_logging_on",
      detail: { scope: patch.call_logging_scope },
    });
  }

  await device.update(updates);

  if (updates.contact_sync_enabled === false && tenantModels.PhoneContact?.destroy) {
    await tenantModels.PhoneContact.destroy({
      where: { operator_device_id: device.operator_device_id },
    });
  }

  for (const ev of auditEvents) {
    await writeDeviceAudit(tenantModels, {
      operatorDeviceId: device.operator_device_id,
      actorUserId,
      action: ev.action,
      detail: ev.detail,
    });
  }

  if (device.push_token) {
    if (shouldWipeBriefCache) {
      await sendDataPush(device, { type: "wipe_cache" }).catch(() => {});
    }
    if (shouldNotifyPolicy) {
      await sendDataPush(device, { type: "policy_changed" }).catch(() => {});
    }
  }

  const { policy } = await getPhoneAssistantPolicy(tenantModels);
  return { device: await formatShopDevice(tenantModels, device, { policy }) };
};

export const getDevicePolicy = async (
  tenantModels,
  tenantDbName,
  device,
  masterModelsOverride = null,
) => {
  const now = nowUtc();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [{ policy }, userCtx, plan, contactCount, callsThisMonth, versionConfig] = await Promise.all([
    getPhoneAssistantPolicy(tenantModels),
    loadUserCapabilitiesContext(tenantModels, device.user_id),
    tenantDbName ? getTenantPlan(tenantDbName) : Promise.resolve(null),
    tenantModels.PhoneContact?.count
      ? tenantModels.PhoneContact.count({
          where: { operator_device_id: device.operator_device_id },
        })
      : Promise.resolve(0),
    tenantModels.CallLog?.count
      ? tenantModels.CallLog.count({
          where: {
            operator_device_id: device.operator_device_id,
            started_at: { [Op.gte]: monthStart },
          },
        })
      : Promise.resolve(0),
    getAppVersionConfig(masterModelsOverride),
  ]);

  const { effective, reasons } = resolveDeviceCapabilities({
    device,
    isAdmin: userCtx.isAdmin,
    permissionSet: userCtx.permissionSet,
    policy,
    planHasPhoneAssistant: plan?.features?.phone_assistant !== false,
    userActive: userCtx.user ? userCtx.user.is_active !== false : true,
  });

  const briefProfile = resolveDeviceBriefProfile(device, userCtx, policy);

  return {
    device_status: device.status || "ACTIVE",
    effective_capabilities: effective,
    capability_reasons: reasons,
    brief_profile: briefProfile,
    cache_scope: policy.cache_scope,
    overlay: policy.overlay,
    unknown_caller: policy.unknown_caller,
    shared_number: policy.shared_number,
    offline_wipe_days: policy.offline_wipe_days,
    contact_sync_mode:
      device.contact_sync_mode || (device.contact_sync_enabled ? "all" : "off"),
    call_logging_scope: device.call_logging_scope || "customers_and_contacts",
    sim_filter: device.sim_filter ?? null,
    muted: Boolean(device.muted),
    contact_sync_policy: policy.contact_sync,
    call_logging_policy: policy.call_logging,
    contact_count: Number(contactCount || 0),
    contacts_synced_at: device.contacts_synced_at
      ? new Date(device.contacts_synced_at).toISOString()
      : null,
    calls_logged_this_month: Number(callsThisMonth || 0),
    paired_at: device.paired_at ? new Date(device.paired_at).toISOString() : null,
    consented_capabilities: normalizeCapabilitiesMap(device.capabilities, DEFAULT_CAPABILITIES_MAP),
    after_call_card: policy.after_call_card || DEFAULT_AFTER_CALL_CARD_POLICY,
    call_screen: briefProfile.call_screen,
    sync: policy.sync,
    notification_languages: policy.notifications?.allowed_languages || ["en"],
    full_app: policy.full_app,
    call_screen_policy: policy.call_screen,
    desktop_popup: policy.desktop_popup,
    ...deviceLanguageAndTextFields(device),
    locked_by_policy: [
      ...(policy.call_screen?.allow_phone_text_scale === false ? ["call_text_scale"] : []),
      ...(policy.full_app?.require_app_lock ? ["app_lock"] : []),
      ...((policy.notifications?.allowed_languages || []).length <= 1 ? ["notification_language"] : []),
    ],
    min_app_version: versionConfig.min_app_version,
    latest_app_version: versionConfig.latest_app_version,
  };
};

/**
 * D5: Send customer selection from a paired phone directly to the paired operator's open POS tab.
 */
export const openCustomerOnDesktop = async (
  models,
  tenantDbName,
  device,
  { customer_id, call_id = null } = {},
) => {
  if (!device?.user_id) {
    throw new AppError("This phone is not paired to a staff user.", 409);
  }
  const customerId = Number(customer_id);
  if (!Number.isFinite(customerId) || customerId <= 0) {
    throw new AppError("Valid customer_id is required.", 400);
  }

  const findOpts = models.CustomerPhone
    ? { include: [{ model: models.CustomerPhone, required: false }] }
    : undefined;
  const customer = models.Customer?.findByPk
    ? findOpts
      ? await models.Customer.findByPk(customerId, findOpts)
      : await models.Customer.findByPk(customerId)
    : null;
  if (!customer) {
    throw new AppError("Customer not found.", 404);
  }

  const customerPlain = typeof customer.toJSON === "function" ? customer.toJSON() : customer;
  const payload = {
    customer_id: Number(customer.customer_id),
    call_id: call_id ?? null,
    customer: customerPlain,
  };

  if (tenantDbName) {
    emitToUser(tenantDbName, Number(device.user_id), "pos:open_customer", payload);
  } else {
    emitToUser(Number(device.user_id), "pos:open_customer", payload);
  }

  return {
    emitted: true,
    customer_id: Number(customer.customer_id),
  };
};

const deviceLanguageAndTextFields = (device) => ({
  notification_language: device.notification_language ?? null,
  app_language: device.app_language ?? null,
  call_text_scale:
    device.call_text_scale === null || device.call_text_scale === undefined
      ? null
      : Number(device.call_text_scale),
  app_text_size: device.app_text_size ?? null,
  app_lock_enabled: Boolean(device.app_lock_enabled),
});

export const updateDeviceSettings = async (
  tenantModels,
  tenantDbName,
  device,
  body = {},
) => {
  const [{ policy }, userCtx, plan] = await Promise.all([
    getPhoneAssistantPolicy(tenantModels),
    loadUserCapabilitiesContext(tenantModels, device.user_id),
    tenantDbName ? getTenantPlan(tenantDbName) : Promise.resolve(null),
  ]);

  assertDeviceSettingsWithinPolicy(policy, {
    contact_sync_mode: body.contact_sync_mode,
    call_logging_scope: body.call_logging_scope,
  });

  const updates = {};
  const auditEvents = [];

  if (body.muted !== undefined && Boolean(body.muted) !== Boolean(device.muted)) {
    updates.muted = Boolean(body.muted);
    auditEvents.push({
      action: updates.muted ? "muted" : "unmuted",
      detail: { source: "device" },
    });
  }

  if (body.contact_sync_mode !== undefined && body.contact_sync_mode !== device.contact_sync_mode) {
    updates.contact_sync_mode = body.contact_sync_mode;
    updates.contact_sync_enabled = body.contact_sync_mode !== "off";
    if (body.contact_sync_mode === "off") {
      updates.contacts_synced_at = null;
    }
    auditEvents.push({
      action: body.contact_sync_mode === "off" ? "contact_sync_off" : "contact_sync_on",
      detail: { mode: body.contact_sync_mode, source: "device" },
    });
  }

  if (
    body.call_logging_scope !== undefined &&
    body.call_logging_scope !== device.call_logging_scope
  ) {
    updates.call_logging_scope = body.call_logging_scope;
    auditEvents.push({
      action: body.call_logging_scope === "off" ? "call_logging_off" : "call_logging_on",
      detail: { scope: body.call_logging_scope, source: "device" },
    });
  }

  if (body.sim_filter !== undefined) {
    updates.sim_filter = body.sim_filter ? String(body.sim_filter).trim().slice(0, 64) : null;
  }
  if (body.notification_language !== undefined) {
    const lang = body.notification_language || null;
    if (lang && !(policy.notifications?.allowed_languages || ["en"]).includes(lang)) {
      throw new AppError("That notification language is not allowed by your shop.", 400, "policy_disallowed");
    }
    updates.notification_language = lang;
  }
  if (body.app_language !== undefined) updates.app_language = body.app_language || null;
  if (body.call_text_scale !== undefined) {
    const value = body.call_text_scale === null ? null : Number(body.call_text_scale);
    if (value !== null) {
      if (policy.call_screen?.allow_phone_text_scale === false) {
        throw new AppError("Your shop does not allow changing the call screen text size on a phone.", 400, "policy_disallowed");
      }
      if (!Number.isFinite(value) || value < policy.call_screen.min || value > policy.call_screen.max) {
        throw new AppError("Call text size is outside your shop's allowed range.", 400, "policy_disallowed");
      }
    }
    updates.call_text_scale = value;
  }
  if (body.app_text_size !== undefined) updates.app_text_size = body.app_text_size || null;
  if (body.app_lock_enabled !== undefined) {
    if (body.app_lock_enabled === false && policy.full_app?.require_app_lock) {
      throw new AppError("Your shop requires the app lock.", 400, "policy_disallowed");
    }
    updates.app_lock_enabled = Boolean(body.app_lock_enabled);
  }

  if (Object.keys(updates).length > 0 && device.update) {
    await device.update(updates);
  }

  if (updates.contact_sync_enabled === false && tenantModels.PhoneContact?.destroy) {
    await tenantModels.PhoneContact.destroy({
      where: { operator_device_id: device.operator_device_id },
    });
  }

  for (const ev of auditEvents) {
    await writeDeviceAudit(tenantModels, {
      operatorDeviceId: device.operator_device_id,
      actorUserId: device.user_id,
      action: ev.action,
      detail: ev.detail,
    });
  }

  const { effective, reasons } = resolveDeviceCapabilities({
    device,
    isAdmin: userCtx.isAdmin,
    permissionSet: userCtx.permissionSet,
    policy,
    planHasPhoneAssistant: plan?.features?.phone_assistant !== false,
    userActive: userCtx.user ? userCtx.user.is_active !== false : true,
  });

  return {
    muted: Boolean(device.muted),
    contact_sync_mode:
      device.contact_sync_mode || (device.contact_sync_enabled ? "all" : "off"),
    call_logging_scope: device.call_logging_scope || "customers_and_contacts",
    sim_filter: device.sim_filter ?? null,
    effective_capabilities: effective,
    capability_reasons: reasons,
    ...deviceLanguageAndTextFields(device),
  };
};

export const wipeShopDevice = async (
  tenantModels,
  deviceId,
  actorUser = null,
  reason = null,
) => {
  const device = await tenantModels.OperatorDevice.findByPk(deviceId);
  if (!device) {
    throw new AppError("Device not found.", 404);
  }
  const actorUserId =
    typeof actorUser === "object" && actorUser
      ? actorUser.userId ?? actorUser.user_id ?? actorUser.id ?? null
      : null;

  await device.update({ briefs_synced_at: null });
  let pushed = false;
  if (device.push_token) {
    const res = await sendDataPush(device, { type: "wipe_cache" }).catch(() => ({ sent: false }));
    pushed = Boolean(res?.sent);
  }
  await writeDeviceAudit(tenantModels, {
    operatorDeviceId: device.operator_device_id,
    actorUserId,
    action: "wiped",
    detail: { reason: reason || null, pushed },
  });
  return { wiped: true, pushed };
};

export const sendTestPushToDevice = async (tenantModels, deviceId) => {
  const device = await tenantModels.OperatorDevice.findByPk(deviceId);
  if (!device) {
    throw new AppError("Device not found.", 404);
  }
  if (!device.push_token) {
    return { sent: false, reason: "no_push_token" };
  }
  const res = await sendPushToDevice(tenantModels, device, {
    title: "GearGrid Test Notification",
    body: "Push delivery to this phone is working.",
    data: { type: "test" },
    channel: "bills",
  });
  return { sent: Boolean(res?.sent), reason: res?.reason ?? null };
};

export const getShopDeviceAudit = async (tenantModels, deviceId) => {
  const device = await tenantModels.OperatorDevice.findByPk(deviceId);
  if (!device) {
    throw new AppError("Device not found.", 404);
  }
  if (!tenantModels.DeviceAuditLog?.findAll) {
    return { logs: [] };
  }
  const rows = await tenantModels.DeviceAuditLog.findAll({
    where: { operator_device_id: deviceId },
    include: tenantModels.User
      ? [
          {
            model: tenantModels.User,
            as: "Actor",
            attributes: ["user_id", "first_name", "last_name", "username"],
            required: false,
          },
        ]
      : [],
    order: [
      ["createdAt", "DESC"],
      ["audit_id", "DESC"],
    ],
    limit: 100,
  });

  return {
    logs: (rows || []).map((r) => ({
      audit_id: Number(r.audit_id),
      operator_device_id: Number(r.operator_device_id),
      actor_user_id: r.actor_user_id != null ? Number(r.actor_user_id) : null,
      actor_name: r.Actor
        ? `${r.Actor.first_name || ""} ${r.Actor.last_name || ""}`.trim() ||
          r.Actor.username ||
          null
        : null,
      action: r.action,
      detail: parseJsonField(r.detail, r.detail ?? null),
      created_at: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
    })),
  };
};

const isTenantShopInactive = (tenant) => {
  if (!tenant) return false;
  if (tenant.subscription_status && tenant.subscription_status !== "Active") {
    return true;
  }
  if (!tenant.subscription_status) return false;
  const flags = parseJsonField(tenant.feature_flags, null);
  return Boolean(
    isPaymentLocked(tenant.subscription_status, flags?.payment_notice ?? null, Date.now()),
  );
};

const findRegisteredDevice = async (masterModels, device_id) => {
  const loadFromTenant = async (tenant) => {
    const tenantConnection = getCachedTenantConnection(tenant.db_name);
    const tenantModels = initTenantModels(tenantConnection);
    const row = await tenantModels.OperatorDevice.findOne({
      where: { device_id },
      include: [
        {
          model: tenantModels.User,
          attributes: ["user_id", "first_name", "last_name", "username", "signature_url"],
        },
      ],
    });
    if (!row) return null;
    return { tenant, tenantModels, device: row };
  };

  // A-14: Consult master DEVICE_REGISTRY first for O(1) tenant resolution.
  const registry = masterModels?.DeviceRegistry;
  if (registry) {
    const regEntry =
      typeof registry.findOne === "function"
        ? await registry.findOne({ where: { device_id } })
        : await registry.findByPk?.(device_id);
    if (regEntry?.tenant_id) {
      try {
        const regTenant = await masterModels.Tenant.findByPk(regEntry.tenant_id);
        if (regTenant) {
          const hit = await loadFromTenant(regTenant);
          if (hit) return hit;
        }
      } catch {
        // Fall through to full tenant scan
      }
    }
  }

  const tenants = await masterModels.Tenant.findAll({
    attributes: ["tenant_id", "db_name", "subscription_status", "feature_flags"],
  });
  for (const tenant of tenants || []) {
    try {
      const hit = await loadFromTenant(tenant);
      if (hit) {
        await upsertDeviceRegistry(masterModels, device_id, tenant.tenant_id);
        return hit;
      }
    } catch {
      // skip inaccessible tenant
    }
  }
  return null;
};

/**
 * Verify optional/required device token on public device endpoints (A-17).
 * Native devices require a matching SHA-256 device token; browser PWAs verify
 * when presented and warn once per device while transitioning.
 */
export const verifyDevicePublicAccess = async (
  masterModels,
  device_id,
  rawToken = null,
  { isNativeClient = false } = {},
) => {
  const found = await findRegisteredDevice(masterModels, device_id);
  if (!found) return null;
  const { device } = found;

  if (device.status === "REVOKED") {
    throw new AppError("Valid device token is required.", 401, "device_revoked");
  }
  if (device.status === "SUSPENDED") {
    throw new AppError("This phone is suspended by your administrator.", 403, "device_suspended");
  }

  const isNative =
    Boolean(device.is_native_app) ||
    Boolean(isNativeClient) ||
    /Capacitor/i.test(String(device.user_agent || ""));

  if (isNative) {
    if (!rawToken || !matchesDeviceToken(rawToken, device)) {
      throw new AppError("Valid device token is required.", 401, "device_revoked");
    }
    return found;
  }

  if (rawToken && (device.token_hash || device.prev_token_hash)) {
    if (!matchesDeviceToken(rawToken, device)) {
      throw new AppError("Valid device token is required.", 401, "device_revoked");
    }
  } else if (!rawToken && !warnedLegacyPublicAccess.has(device_id)) {
    warnedLegacyPublicAccess.add(device_id);
    console.warn(
      `[deviceService] Deprecation warning: public device endpoint called without x-device-token for browser device ${device_id}.`,
    );
  }

  return found;
};

// Public phone-side status check. Looks up DEVICE_REGISTRY first and falls
// back across tenants so inactive shops report `shop_inactive: true` cleanly (A-14, A-15).
export const getDeviceStatus = async (masterModels, device_id) => {
  const found = await findRegisteredDevice(masterModels, device_id);
  if (!found || found.device.status === "REVOKED") {
    return {
      paired: false,
      ...(found?.device?.status === "REVOKED" ? { device_status: "REVOKED" } : {}),
      tenant_db_name: null,
      operator: null,
      tenant: null,
    };
  }

  const { tenant, tenantModels, device: row } = found;
  // Touch last_seen_at opportunistically; swallow failures.
  row.update?.({ last_seen_at: nowUtc() })?.catch?.(() => {});

  const tenantConfig = await tenantModels.TenantConfig.findOne();
  const operatorName =
    `${row.User?.first_name || ""} ${row.User?.last_name || ""}`.trim() ||
    row.User?.username ||
    "Operator";
  const shopInactive = isTenantShopInactive(tenant);

  return {
    paired: true,
    ...(shopInactive ? { shop_inactive: true } : {}),
    device_status: row.status || "ACTIVE",
    tenant_db_name: tenant.db_name,
    operator: {
      user_id: row.User?.user_id,
      operator_name: operatorName,
      username: row.User?.username || null,
      has_saved_signature: !!row.User?.signature_url,
    },
    tenant: {
      business_display_name: tenantConfig?.business_display_name || "GearGrid",
      logo_url: tenantConfig?.logo_url || null,
      primary_color: tenantConfig?.primary_color || "#1976d2",
      secondary_color: tenantConfig?.secondary_color || "#9c27b0",
    },
  };
};

export const getPendingSignaturesForDevice = async (masterModels, device_id) => {
  const status = await getDeviceStatus(masterModels, device_id);
  if (!status.paired) throw new AppError("Device not paired.", 404);

  const tenantConnection = getCachedTenantConnection(status.tenant_db_name);
  const tenantModels = initTenantModels(tenantConnection);
  const lookbackCutoff = new Date(nowUtc().getTime() - PENDING_LOOKBACK_MS);

  const requests = await tenantModels.SignatureRequest.findAll({
    where: {
      requested_by_user_id: status.operator.user_id,
      status: { [Op.in]: ["PENDING", "PARTIAL"] },
      expires_at: { [Op.gt]: nowUtc() },
      createdAt: { [Op.gte]: lookbackCutoff },
    },
    order: [["createdAt", "DESC"]],
    limit: 10,
  });

  // INVOICE has no dedicated `invoice_number` column — the display number is
  // derived from invoice_id as `INV-<id>` everywhere else in the codebase
  // (reports, receipt). Asking for `invoice_number` as an attribute makes
  // MySQL throw ER_BAD_FIELD_ERROR, which was the cause of the phone's
  // "Couldn't fetch pending requests" alert.
  const invoiceIds = [...new Set(requests.map((r) => r.invoice_id))];
  const invoices = invoiceIds.length
    ? await tenantModels.Invoice.findAll({
        where: { invoice_id: { [Op.in]: invoiceIds } },
        attributes: ["invoice_id"],
      })
    : [];
  const invoiceNumberById = Object.fromEntries(
    invoices.map((i) => [i.invoice_id, `INV-${i.invoice_id}`]),
  );

  const requestIds = requests.map((r) => r.request_id);
  const captured = requestIds.length
    ? await tenantModels.InvoiceSignature.findAll({
        where: { signature_request_id: { [Op.in]: requestIds } },
        attributes: ["signature_request_id", "signatory_role"],
      })
    : [];
  const capturedByRequest = {};
  for (const row of captured) {
    (capturedByRequest[row.signature_request_id] ||= []).push(row.signatory_role);
  }

  return {
    pending: requests
      .map((r) => {
        const required = Array.isArray(r.required_roles)
          ? r.required_roles
          : JSON.parse(r.required_roles || "[]");
        const done = capturedByRequest[r.request_id] || [];
        const pendingRoles = required.filter((role) => !done.includes(role));
        return {
          token: r.token,
          invoice_id: r.invoice_id,
          invoice_number: invoiceNumberById[r.invoice_id] || `INV-${r.invoice_id}`,
          checkpoint: r.checkpoint,
          required_roles: required,
          pending_roles: pendingRoles,
          expires_at: r.expires_at,
        };
      })
      // Hide fully-signed sessions even if they haven't been swept to COMPLETED yet.
      .filter((p) => p.pending_roles.length > 0),
  };
};

export const sweepExpiredPairingCodes = async (masterModels) => {
  const [affected] = await masterModels.DevicePairingCode.update(
    { status: "EXPIRED" },
    {
      where: {
        status: "PENDING",
        expires_at: { [Op.lt]: nowUtc() },
      },
    },
  );
  return { expired: affected || 0 };
};
