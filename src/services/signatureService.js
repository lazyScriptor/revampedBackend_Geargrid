import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Op } from "sequelize";
import AppError from "../utils/AppError.js";
import { emitToUser } from "../sockets/emitters.js";
import { liveTotalOf } from "../utils/invoiceBalance.js";

// ─────────────────────────────────────────────────────────────────────────
// Signature capture subsystem
//
// Lifecycle:
//   createSignatureRequest  → row inserted, status=PENDING, token minted
//   getPublicSignatureSession → returns everything the phone needs to render
//   submitSignature         → inserts InvoiceSignature, updates request status,
//                             emits socket, closes request when all captured
//   cancelSignatureRequest  → status=CANCELLED
//   listInvoiceSignatures   → captured signatures for an invoice
//   setOperatorSignature    → stores PNG against USERS.signature_url
// ─────────────────────────────────────────────────────────────────────────

const UPLOADS_ROOT = path.resolve("uploads");
const SIGNATURES_SUBDIR = "signatures";
const MAX_PNG_BYTES = 300 * 1024; // 300 KB; well above anything a canvas needs

// ── Helpers ──────────────────────────────────────────────────────────────

const mintToken = () => crypto.randomBytes(24).toString("base64url");

const nowUtc = () => new Date();

const buildPublicPath = (relative) => {
  // app.js serves /uploads statically. Translate on-disk relative path to URL.
  // e.g. "signatures/geargrid_demo/42/5.png" → "/uploads/signatures/geargrid_demo/42/5.png"
  return `/uploads/${relative.split(path.sep).join("/")}`;
};

const sanitizeTenantSlug = (tenantDbName) =>
  String(tenantDbName || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");

const decodeDataUrl = (dataUrl) => {
  // Accept both "data:image/png;base64,..." and bare base64.
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl.trim());
  const base64 = match ? match[2] : dataUrl.trim();
  const buffer = Buffer.from(base64, "base64");
  if (!buffer || buffer.length === 0) {
    throw new AppError("Signature image is empty or invalid.", 400);
  }
  if (buffer.length > MAX_PNG_BYTES) {
    throw new AppError(
      `Signature image too large (${buffer.length} bytes, max ${MAX_PNG_BYTES}).`,
      413,
    );
  }
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const extension = match && /jpe?g/i.test(match[1]) ? "jpg" : "png";
  return { buffer, sha256, extension };
};

const writeSignatureFile = async ({
  tenantDbName,
  invoiceId,
  signatureId,
  buffer,
  extension,
}) => {
  const relativeDir = path.join(
    SIGNATURES_SUBDIR,
    sanitizeTenantSlug(tenantDbName),
    String(invoiceId),
  );
  const absoluteDir = path.join(UPLOADS_ROOT, relativeDir);
  await fs.mkdir(absoluteDir, { recursive: true });
  const filename = `${signatureId}.${extension}`;
  const absolutePath = path.join(absoluteDir, filename);
  await fs.writeFile(absolutePath, buffer);
  return buildPublicPath(path.join(relativeDir, filename));
};

const writeOperatorSignatureFile = async ({ tenantDbName, userId, buffer, extension }) => {
  const relativeDir = path.join(
    SIGNATURES_SUBDIR,
    sanitizeTenantSlug(tenantDbName),
    "operators",
  );
  const absoluteDir = path.join(UPLOADS_ROOT, relativeDir);
  await fs.mkdir(absoluteDir, { recursive: true });
  // Overwrite the operator's single stored signature in place.
  const filename = `user-${userId}.${extension}`;
  const absolutePath = path.join(absoluteDir, filename);
  await fs.writeFile(absolutePath, buffer);
  return buildPublicPath(path.join(relativeDir, filename));
};

const isExpired = (row) =>
  row.expires_at && new Date(row.expires_at).getTime() < nowUtc().getTime();

const computeStatusAfterCapture = (requiredRoles, capturedRoles) => {
  const haveAll = requiredRoles.every((r) => capturedRoles.includes(r));
  if (haveAll) return "COMPLETED";
  if (capturedRoles.length === 0) return "PENDING";
  return "PARTIAL";
};

const toCapturedSummary = (sig) => ({
  role: sig.signatory_role,
  signatory_name: sig.signatory_name,
  captured_at: sig.captured_at,
});

// ── Public API ───────────────────────────────────────────────────────────

export const createSignatureRequest = async (
  models,
  user,
  invoiceId,
  { checkpoint, required_roles, expires_in_minutes = 10 },
) => {
  const invoice = await models.Invoice.findByPk(invoiceId);
  if (!invoice) throw new AppError("Invoice not found", 404);

  const token = mintToken();
  const expires_at = new Date(nowUtc().getTime() + expires_in_minutes * 60_000);

  const row = await models.SignatureRequest.create({
    invoice_id: invoiceId,
    checkpoint,
    required_roles,
    token,
    requested_by_user_id: user?.id || user?.userId || 1,
    status: "PENDING",
    expires_at,
  });

  const autoSigned = await autoSignOperator(models, row, { tenantDbName: user?.tenantDbName });

  return {
    token: row.token,
    sign_path: `/sign/${row.token}`,
    checkpoint: row.checkpoint,
    required_roles: row.required_roles,
    expires_at: row.expires_at,
    status: autoSigned?.status || row.status,
    auto_signed_roles: autoSigned ? ["OPERATOR"] : [],
    pending_roles: autoSigned?.pending_roles || required_roles,
  };
};

// The operator signs the same way on every bill, so once they have a saved
// signature it goes on by itself the moment the request is made; the phone
// only ever asks the customer. Best effort: if the saved file is missing the
// role simply stays pending and the operator can draw on the phone.
const autoSignOperator = async (models, request, { tenantDbName }) => {
  const roles = Array.isArray(request.required_roles)
    ? request.required_roles
    : JSON.parse(request.required_roles || "[]");
  if (!roles.includes("OPERATOR")) return null;
  const operator = await models.User.findByPk(request.requested_by_user_id, {
    attributes: ["user_id", "first_name", "last_name", "username", "signature_url"],
  });
  if (!operator?.signature_url) return null;
  const terms = await getRentalTerms(models);
  try {
    return await submitSignature(
      models,
      request.token,
      {
        role: "OPERATOR",
        signatory_name: operatorDisplayName(operator),
        agreed_to_terms: true,
        terms_version: terms.version,
        use_stored_operator_signature: true,
      },
      { tenantDbName, userAgent: "auto: saved operator signature" },
    );
  } catch {
    return null;
  }
};

const operatorDisplayName = (u) =>
  `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username || "Operator";

export const getPublicSignatureSession = async (models, token) => {
  const request = await models.SignatureRequest.findOne({ where: { token } });
  if (!request) throw new AppError("Signature session not found", 404);

  // Lazy expire — flip status if the TTL has run out.
  let status = request.status;
  if (status === "PENDING" || status === "PARTIAL") {
    if (isExpired(request)) {
      status = "EXPIRED";
      await request.update({ status });
    }
  }

  const [invoice, tenantConfig, capturedSignatures] = await Promise.all([
    models.Invoice.findByPk(request.invoice_id, {
      include: models.Customer ? [{ model: models.Customer, attributes: ["first_name", "last_name"] }] : [],
    }),
    models.TenantConfig.findOne(),
    models.InvoiceSignature.findAll({
      where: { signature_request_id: request.request_id },
      order: [["captured_at", "ASC"]],
    }),
  ]);

  if (!invoice) throw new AppError("Invoice no longer exists", 410);

  const customerName = invoice.Customer
    ? `${invoice.Customer.first_name || ""} ${invoice.Customer.last_name || ""}`.trim()
    : null;

  const requiredRoles = Array.isArray(request.required_roles)
    ? request.required_roles
    : JSON.parse(request.required_roles || "[]");
  const capturedRoles = capturedSignatures.map((s) => s.signatory_role);
  const pendingRoles = requiredRoles.filter((r) => !capturedRoles.includes(r));

  // Operator saved signature — only offer "use stored" for the operator who
  // originally created the session; a different operator would need to draw
  // fresh. Keeps the UX one-tap for the common case without introducing a
  // login step on the public page.
  let operatorSavedSignature = null;
  if (requiredRoles.includes("OPERATOR")) {
    const requester = await models.User.findByPk(request.requested_by_user_id, {
      attributes: ["user_id", "first_name", "last_name", "username", "signature_url"],
    });
    if (requester) {
      operatorSavedSignature = {
        operator_user_id: requester.user_id,
        operator_name:
          `${requester.first_name || ""} ${requester.last_name || ""}`.trim() ||
          requester.username,
        has_saved_signature: !!requester.signature_url,
      };
    }
  }

  return {
    status,
    checkpoint: request.checkpoint,
    invoice: {
      invoice_id: invoice.invoice_id,
      invoice_number: invoice.invoice_number || `INV-${invoice.invoice_id}`,
      total_amount: liveTotalOf(invoice),
      amount_paid: Number(invoice.amount_paid || invoice.advance_paid || 0),
      deposit_held: Number(invoice.deposit_held || 0),
      customer_name: customerName,
    },
    tenant: {
      business_display_name: tenantConfig?.business_display_name || "GearGrid",
      logo_url: tenantConfig?.logo_url || null,
      primary_color: tenantConfig?.primary_color || "#1976d2",
      secondary_color: tenantConfig?.secondary_color || "#9c27b0",
    },
    terms: {
      markdown:
        tenantConfig?.rental_terms_markdown ||
        "By signing, you acknowledge receipt of the rented equipment and agree to return it in the same condition.",
      version: Number(tenantConfig?.rental_terms_version || 1),
    },
    required_roles: requiredRoles,
    captured_roles: capturedSignatures.map(toCapturedSummary),
    pending_roles: pendingRoles,
    operator_saved_signature: operatorSavedSignature,
    expires_at: request.expires_at,
  };
};

export const submitSignature = async (
  models,
  token,
  payload,
  { ip = null, userAgent = null, tenantDbName = null } = {},
) => {
  const {
    role,
    signatory_name,
    agreed_to_terms,
    terms_version,
    use_stored_operator_signature = false,
    image_data_url,
  } = payload;

  if (!agreed_to_terms) {
    throw new AppError("Must agree to terms before signing.", 400);
  }

  const request = await models.SignatureRequest.findOne({ where: { token } });
  if (!request) throw new AppError("Signature session not found", 404);

  if (["COMPLETED", "EXPIRED", "CANCELLED"].includes(request.status)) {
    throw new AppError(`This session is ${request.status.toLowerCase()}.`, 410);
  }
  if (isExpired(request)) {
    await request.update({ status: "EXPIRED" });
    throw new AppError("This signature session has expired.", 410);
  }

  const requiredRoles = Array.isArray(request.required_roles)
    ? request.required_roles
    : JSON.parse(request.required_roles || "[]");
  if (!requiredRoles.includes(role)) {
    throw new AppError(`Role ${role} is not required by this session.`, 400);
  }

  const alreadyCaptured = await models.InvoiceSignature.findOne({
    where: { signature_request_id: request.request_id, signatory_role: role },
  });
  if (alreadyCaptured) {
    throw new AppError(`${role} has already signed on this session.`, 409);
  }

  // ── Resolve image bytes ──────────────────────────────────────────────
  let signatoryUserId = null;
  let source = "PHONE_CANVAS";
  let buffer;
  let extension;
  let sha256;

  if (use_stored_operator_signature) {
    if (role !== "OPERATOR") {
      throw new AppError("Stored signature only available for OPERATOR role.", 400);
    }
    const requester = await models.User.findByPk(request.requested_by_user_id, {
      attributes: ["user_id", "first_name", "last_name", "username", "signature_url"],
    });
    if (!requester?.signature_url) {
      throw new AppError("The requesting operator has no saved signature.", 400);
    }
    // Load the stored PNG off disk so we can hash/attribute it as a fresh capture.
    const absoluteStored = path.join(
      UPLOADS_ROOT,
      requester.signature_url.replace(/^\/?uploads\//, ""),
    );
    try {
      buffer = await fs.readFile(absoluteStored);
    } catch {
      throw new AppError("Stored operator signature file is missing.", 500);
    }
    sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    extension = absoluteStored.toLowerCase().endsWith(".jpg") ? "jpg" : "png";
    signatoryUserId = requester.user_id;
    source = "STORED_OPERATOR_SIG";
  } else {
    if (!image_data_url) {
      throw new AppError("image_data_url is required.", 400);
    }
    const decoded = decodeDataUrl(image_data_url);
    buffer = decoded.buffer;
    sha256 = decoded.sha256;
    extension = decoded.extension;
    if (role === "OPERATOR") {
      // First time the operator draws: keep it as their saved signature so
      // every later bill is signed for them automatically.
      const requester = await models.User.findByPk(request.requested_by_user_id, {
        attributes: ["user_id", "signature_url"],
      });
      if (requester && !requester.signature_url) {
        signatoryUserId = requester.user_id;
        await setOperatorSignature(models, requester.user_id, { image_data_url }, { tenantDbName }).catch(() => {});
      }
    }
  }

  // ── Insert row (empty image_url first, then write file using row id) ─
  const signature = await models.InvoiceSignature.create({
    invoice_id: request.invoice_id,
    signature_request_id: request.request_id,
    checkpoint: request.checkpoint,
    signatory_role: role,
    signatory_name,
    signatory_user_id: signatoryUserId,
    image_url: "pending", // overwritten in the next step
    image_sha256: sha256,
    source,
    captured_from_ip: ip,
    captured_from_user_agent: userAgent ? userAgent.slice(0, 500) : null,
    terms_version_signed: terms_version,
    captured_at: nowUtc(),
  });

  const image_url = await writeSignatureFile({
    tenantDbName,
    invoiceId: request.invoice_id,
    signatureId: signature.signature_id,
    buffer,
    extension,
  });
  await signature.update({ image_url });

  // ── Recompute session status ────────────────────────────────────────
  const allSignatures = await models.InvoiceSignature.findAll({
    where: { signature_request_id: request.request_id },
    attributes: ["signatory_role"],
  });
  const capturedRoles = allSignatures.map((s) => s.signatory_role);
  const nextStatus = computeStatusAfterCapture(requiredRoles, capturedRoles);
  await request.update({ status: nextStatus });
  const pendingRoles = requiredRoles.filter((r) => !capturedRoles.includes(r));
  const allCaptured = nextStatus === "COMPLETED";

  // ── Emit socket events to the requesting operator ───────────────────
  emitToUser(tenantDbName, request.requested_by_user_id, "signature:captured", {
    request_id: request.request_id,
    invoice_id: request.invoice_id,
    role,
    signatory_name,
    image_url,
    captured_at: signature.captured_at,
    pending_roles: pendingRoles,
  });
  if (allCaptured) {
    emitToUser(tenantDbName, request.requested_by_user_id, "signature:all-captured", {
      request_id: request.request_id,
      invoice_id: request.invoice_id,
      checkpoint: request.checkpoint,
    });
  }

  return {
    signature_id: signature.signature_id,
    role,
    status: nextStatus,
    captured_roles: capturedRoles,
    pending_roles: pendingRoles,
    all_captured: allCaptured,
  };
};

export const cancelSignatureRequest = async (models, token, user, { tenantDbName } = {}) => {
  const request = await models.SignatureRequest.findOne({ where: { token } });
  if (!request) throw new AppError("Signature session not found", 404);
  if (["COMPLETED", "EXPIRED", "CANCELLED"].includes(request.status)) {
    return { cancelled: false };
  }
  await request.update({ status: "CANCELLED" });
  emitToUser(tenantDbName, request.requested_by_user_id, "signature:cancelled", {
    request_id: request.request_id,
    invoice_id: request.invoice_id,
  });
  return { cancelled: true };
};

export const listInvoiceSignatures = async (models, invoiceId) => {
  const rows = await models.InvoiceSignature.findAll({
    where: { invoice_id: invoiceId },
    order: [["captured_at", "ASC"]],
  });
  return {
    signatures: rows.map((r) => ({
      signature_id: r.signature_id,
      checkpoint: r.checkpoint,
      role: r.signatory_role,
      signatory_name: r.signatory_name,
      signatory_user_id: r.signatory_user_id,
      image_url: r.image_url,
      source: r.source,
      captured_at: r.captured_at,
      terms_version_signed: r.terms_version_signed,
    })),
  };
};

export const setOperatorSignature = async (
  models,
  userId,
  { image_data_url },
  { tenantDbName } = {},
) => {
  const user = await models.User.findByPk(userId);
  if (!user) throw new AppError("User not found", 404);

  const { buffer, extension } = decodeDataUrl(image_data_url);
  const signature_url = await writeOperatorSignatureFile({
    tenantDbName,
    userId,
    buffer,
    extension,
  });
  const captured_at = nowUtc();
  await user.update({ signature_url, signature_captured_at: captured_at });
  return { signature_url, captured_at };
};

export const deleteOperatorSignature = async (models, userId) => {
  const user = await models.User.findByPk(userId);
  if (!user) throw new AppError("User not found", 404);
  if (!user.signature_url) return { deleted: false };
  // Best-effort file cleanup; the DB fields are the source of truth.
  try {
    const absolute = path.join(
      UPLOADS_ROOT,
      user.signature_url.replace(/^\/?uploads\//, ""),
    );
    await fs.unlink(absolute);
  } catch {
    // ignore
  }
  await user.update({ signature_url: null, signature_captured_at: null });
  return { deleted: true };
};

export const getRentalTerms = async (models) => {
  const config = await models.TenantConfig.findOne();
  return {
    markdown:
      config?.rental_terms_markdown ||
      "By signing, you acknowledge receipt of the rented equipment and agree to return it in the same condition.",
    version: Number(config?.rental_terms_version || 1),
    updated_at: config?.updatedAt || null,
  };
};

export const updateRentalTerms = async (models, markdown) => {
  const config = await models.TenantConfig.findOne();
  if (!config) throw new AppError("Tenant config missing.", 500);
  const nextVersion = Number(config.rental_terms_version || 1) + 1;
  await config.update({
    rental_terms_markdown: markdown,
    rental_terms_version: nextVersion,
  });
  return {
    markdown,
    version: nextVersion,
    updated_at: new Date(),
  };
};

// ── Housekeeping — expire old PENDING / PARTIAL sessions ────────────────
// Call from a cron if desired; the lazy-expire in getPublicSignatureSession
// handles accuracy at read time regardless.
export const sweepExpiredSessions = async (models) => {
  const [affected] = await models.SignatureRequest.update(
    { status: "EXPIRED" },
    {
      where: {
        status: { [Op.in]: ["PENDING", "PARTIAL"] },
        expires_at: { [Op.lt]: nowUtc() },
      },
    },
  );
  return { expired: affected || 0 };
};
