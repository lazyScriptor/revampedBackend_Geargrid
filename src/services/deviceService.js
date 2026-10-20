import crypto from "node:crypto";
import { Op } from "sequelize";
import AppError from "../utils/AppError.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";

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

// Readable, ambiguous-free alphabet. No 0/O, 1/I/L.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

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

// ── Authenticated side (operator on POS) ────────────────────────────────

export const mintPairingCode = async (masterModels, { tenant_id, user_id }) => {
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

  const expires_at = new Date(nowUtc().getTime() + PAIRING_CODE_TTL_MS);
  await masterModels.DevicePairingCode.create({
    code,
    tenant_id,
    user_id,
    status: "PENDING",
    expires_at,
  });

  return { code, expires_at };
};

export const listMyDevices = async (tenantModels, userId) => {
  const rows = await tenantModels.OperatorDevice.findAll({
    where: { user_id: userId },
    order: [["paired_at", "DESC"]],
  });
  return {
    devices: rows.map((r) => ({
      operator_device_id: r.operator_device_id,
      device_id: r.device_id,
      device_label: r.device_label,
      user_agent: r.user_agent,
      paired_at: r.paired_at,
      last_seen_at: r.last_seen_at,
    })),
  };
};

export const unpairDevice = async (tenantModels, operatorDeviceId, userId) => {
  const row = await tenantModels.OperatorDevice.findOne({
    where: { operator_device_id: operatorDeviceId, user_id: userId },
  });
  if (!row) return { unpaired: false };
  await row.destroy();
  return { unpaired: true };
};

// ── Public side (phone) ─────────────────────────────────────────────────

export const claimPairingCode = async (masterModels, { code, device_id, device_label, user_agent }) => {
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

  // Connect to the owning tenant DB and create / refresh OperatorDevice.
  const tenantConnection = getCachedTenantConnection(tenant.db_name);
  const tenantModels = initTenantModels(tenantConnection);

  // If this device_id was previously paired (e.g. same phone re-pairing),
  // flip it to the new operator rather than erroring out.
  const existing = await tenantModels.OperatorDevice.findOne({ where: { device_id } });
  let devicePaired;
  if (existing) {
    await existing.update({
      user_id: row.user_id,
      device_label: device_label?.slice(0, 100) || existing.device_label,
      user_agent: user_agent?.slice(0, 500) || existing.user_agent,
      paired_at: nowUtc(),
      last_seen_at: nowUtc(),
    });
    devicePaired = existing;
  } else {
    devicePaired = await tenantModels.OperatorDevice.create({
      user_id: row.user_id,
      device_id,
      device_label: device_label?.slice(0, 100) || null,
      user_agent: user_agent?.slice(0, 500) || null,
      paired_at: nowUtc(),
      last_seen_at: nowUtc(),
    });
  }

  await row.update({
    status: "CLAIMED",
    claimed_device_id: device_id,
    claimed_at: nowUtc(),
  });

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

  return {
    operator_device_id: devicePaired.operator_device_id,
    device_id,
    tenant_db_name: tenant.db_name,
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

// Public phone-side status check. The phone passes its own device_id and we
// look across active tenant DBs for an OPERATOR_DEVICES row with it.
// Called at PWA launch to decide between "show pairing input" and "redirect
// to signature home".
export const getDeviceStatus = async (masterModels, device_id) => {
  const tenants = await masterModels.Tenant.findAll({
    where: { subscription_status: "Active" },
    attributes: ["tenant_id", "db_name"],
  });
  for (const tenant of tenants) {
    try {
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
      if (!row) continue;

      // Touch last_seen_at opportunistically; swallow failures.
      row.update({ last_seen_at: nowUtc() }).catch(() => {});

      const tenantConfig = await tenantModels.TenantConfig.findOne();
      const operatorName =
        `${row.User?.first_name || ""} ${row.User?.last_name || ""}`.trim() ||
        row.User?.username ||
        "Operator";
      return {
        paired: true,
        tenant_db_name: tenant.db_name,
        operator: {
          user_id: row.User?.user_id,
          operator_name: operatorName,
          has_saved_signature: !!row.User?.signature_url,
        },
        tenant: {
          business_display_name: tenantConfig?.business_display_name || "GearGrid",
          logo_url: tenantConfig?.logo_url || null,
          primary_color: tenantConfig?.primary_color || "#1976d2",
          secondary_color: tenantConfig?.secondary_color || "#9c27b0",
        },
      };
    } catch {
      // skip inaccessible tenant
    }
  }
  return { paired: false, tenant_db_name: null, operator: null, tenant: null };
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
