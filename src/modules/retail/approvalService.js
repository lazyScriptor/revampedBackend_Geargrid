import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { Op } from "sequelize";
import AppError from "../../utils/AppError.js";
import { COUNTER_EXCEPTION_TYPES } from "../../models/CounterException.js";
import { getRetailSettings } from "./retailSettingsService.js";
import { addCents, fromCents, toCents } from "./money.js";
import { emitToTenant, emitToUser } from "../../sockets/emitters.js";
import { getToSortDeskItems } from "./sales/saleLinesService.js";

const PIN_RE = /^\d{4,6}$/;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MS = 10 * 60 * 1000;
const REQUESTER_MAX_FAILURES = 10;
const REQUESTER_WINDOW_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 60 * 1000;
const REQUEST_TTL_MS = 5 * 60 * 1000;
const ADMIN_ROLE_NAMES = new Set(["admin", "owner", "superadmin", "super_admin"]);

const requesterFailures = new Map();

export const clearRequesterFailureLimiter = () => {
  requesterFailures.clear();
};

const assertRequesterWithinLimit = (requesterUserId, now) => {
  const cutoff = now.getTime() - REQUESTER_WINDOW_MS;
  const list = (requesterFailures.get(Number(requesterUserId)) || []).filter((ts) => ts > cutoff);
  if (list.length === 0) {
    requesterFailures.delete(Number(requesterUserId));
  } else {
    requesterFailures.set(Number(requesterUserId), list);
  }
  if (list.length >= REQUESTER_MAX_FAILURES) {
    throw new AppError(
      "Too many failed approval attempts. Please try again in 10 minutes.",
      429,
    );
  }
};

const forgetRequesterAttempt = (requesterUserId) => {
  const list = requesterFailures.get(Number(requesterUserId));
  if (list && list.length) list.pop();
};

const recordRequesterFailure = (requesterUserId, now) => {
  const key = Number(requesterUserId);
  const cutoff = now.getTime() - REQUESTER_WINDOW_MS;
  const list = (requesterFailures.get(key) || []).filter((ts) => ts > cutoff);
  list.push(now.getTime());
  requesterFailures.set(key, list);
};

export { COUNTER_EXCEPTION_TYPES };

export const sha256Hex = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

const canonicalize = (value) => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        sorted[key] = canonicalize(value[key]);
      }
    }
    return sorted;
  }
  return value;
};

export const hashContext = (context) =>
  sha256Hex(JSON.stringify(canonicalize(context ?? {})));

const assertValidExceptionType = (type) => {
  if (!COUNTER_EXCEPTION_TYPES.includes(type)) {
    throw new AppError(`Invalid counter exception type: ${type}`, 400);
  }
};

const runInTransaction = async (models, fn) => {
  if (models?.sequelize?.transaction) {
    return models.sequelize.transaction(fn);
  }
  return fn(undefined);
};

const computeUserHasPermission = (user, permissionCode, overrides = []) => {
  if (!user || user.is_active === false) return false;
  const roles = user.Roles || [];
  let maxHierarchy = 0;
  const effective = new Set();
  for (const role of roles) {
    const level = Number(role.hierarchy_level || 0);
    if (level > maxHierarchy) maxHierarchy = level;
    if (ADMIN_ROLE_NAMES.has(String(role.role_name || "").toLowerCase().trim())) {
      return true;
    }
    for (const perm of role.Permissions || []) {
      effective.add(perm.permission_code);
    }
  }
  if (maxHierarchy >= 100) return true;

  for (const ov of overrides) {
    const code = ov.Permission?.permission_code || ov.permission_code;
    if (!code) continue;
    if (ov.grant_type === "grant") effective.add(code);
    else if (ov.grant_type === "revoke") effective.delete(code);
  }
  return effective.has(permissionCode);
};

export const userHasApprovalsDecide = async (models, userId) => {
  const user = await models.User.findByPk(userId, {
    include: [
      {
        model: models.Role,
        include: [
          {
            model: models.Permission,
            attributes: ["permission_id", "permission_code"],
            through: { attributes: [] },
          },
        ],
        attributes: ["role_id", "role_name", "hierarchy_level"],
      },
    ],
  });
  if (!user || user.is_active === false) return { user: null, allowed: false };

  const overrides = models.UserPermissionOverride?.findAll
    ? await models.UserPermissionOverride.findAll({
        where: { user_id: userId },
        include: [{ model: models.Permission, attributes: ["permission_code"] }],
      })
    : [];

  return {
    user,
    allowed: computeUserHasPermission(user, "approvals:decide", overrides),
  };
};

export const listApprovers = async (models) => {
  const users = await models.User.findAll({
    where: { is_active: true },
    include: [
      {
        model: models.Role,
        include: [
          {
            model: models.Permission,
            attributes: ["permission_id", "permission_code"],
            through: { attributes: [] },
          },
        ],
        attributes: ["role_id", "role_name", "hierarchy_level"],
      },
    ],
    order: [["first_name", "ASC"], ["last_name", "ASC"]],
  });

  const allOverrides = models.UserPermissionOverride?.findAll
    ? await models.UserPermissionOverride.findAll({
        include: [{ model: models.Permission, attributes: ["permission_code"] }],
      })
    : [];
  const overridesByUser = new Map();
  for (const ov of allOverrides) {
    const list = overridesByUser.get(ov.user_id) || [];
    list.push(ov);
    overridesByUser.set(ov.user_id, list);
  }

  return users
    .filter((u) => computeUserHasPermission(u, "approvals:decide", overridesByUser.get(u.user_id) || []))
    .map((u) => ({
      user_id: u.user_id,
      id: u.user_id,
      display_name: [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.username,
      avatar_url: u.avatar_url || null,
      has_pin: Boolean(u.approval_pin_hash),
    }));
};

export const setMyApprovalPin = async (models, userId, { current_password, pin } = {}) => {
  if (!current_password || typeof current_password !== "string") {
    throw new AppError("Current password is required.", 400);
  }
  if (typeof pin !== "string" || !PIN_RE.test(pin)) {
    throw new AppError("Approval PIN must be 4 to 6 digits.", 400);
  }

  const user = await models.User.findByPk(userId);
  if (!user || user.is_active === false) {
    throw new AppError("User not found.", 404);
  }

  const passwordValid = await bcrypt.compare(current_password, user.password_hash);
  if (!passwordValid) {
    throw new AppError("Current password is incorrect.", 401);
  }

  const pinHash = await bcrypt.hash(pin, 10);
  await user.update({
    approval_pin_hash: pinHash,
    pin_failed_count: 0,
    pin_locked_until: null,
  });

  return { message: "Approval PIN updated." };
};

const issueApprovalToken = async (
  models,
  { exceptionId, type, approverUserId, requesterUserId, context, now = new Date(), transaction },
) => {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
  const opts = transaction ? { transaction } : {};

  await models.ApprovalToken.create(
    {
      token_hash: tokenHash,
      exception_id: exceptionId ?? null,
      action: type,
      approver_user_id: approverUserId,
      requester_user_id: requesterUserId,
      context: context ?? {},
      context_hash: hashContext(context),
      expires_at: expiresAt,
      used_at: null,
      createdAt: now,
    },
    opts,
  );

  return { approval_token: rawToken, expires_at: expiresAt };
};

// Each approval attempt is counted BEFORE the PIN/password is compared, in one atomic UPDATE that
// only succeeds while the approver is not locked and has fewer than PIN_MAX_ATTEMPTS failures. So
// however many guesses arrive at once, at most PIN_MAX_ATTEMPTS can ever reach bcrypt; the rest are
// refused as locked. A success resets the counter; the 5th failure starts the 10-minute lock.
const reserveApproverAttempt = async (models, approver, now) => {
  if (models?.sequelize?.query) {
    const [result] = await models.sequelize.query(
      `UPDATE \`USERS\`
       SET pin_failed_count = IF(pin_locked_until IS NOT NULL AND pin_locked_until <= ?, 1, pin_failed_count + 1),
           pin_locked_until = IF(pin_locked_until IS NOT NULL AND pin_locked_until <= ?, NULL, pin_locked_until)
       WHERE user_id = ?
         AND ((pin_locked_until IS NOT NULL AND pin_locked_until <= ?)
              OR (pin_locked_until IS NULL AND pin_failed_count < ?))`,
      { replacements: [now, now, approver.user_id, now, PIN_MAX_ATTEMPTS] },
    );
    const affected = Number(result?.affectedRows ?? result?.changedRows ?? result ?? 0);
    return affected === 1;
  }
  // Fake models in unit tests: same rule, not atomic.
  const lockExpired = approver.pin_locked_until && new Date(approver.pin_locked_until) <= now;
  if (!lockExpired && (approver.pin_locked_until || Number(approver.pin_failed_count || 0) >= PIN_MAX_ATTEMPTS)) {
    return false;
  }
  await approver.update({
    pin_failed_count: lockExpired ? 1 : Number(approver.pin_failed_count || 0) + 1,
    pin_locked_until: lockExpired ? null : approver.pin_locked_until ?? null,
  });
  return true;
};

const lockApproverIfLimitReached = async (models, approver, now) => {
  if (models?.sequelize?.query) {
    await models.sequelize.query(
      `UPDATE \`USERS\` SET pin_locked_until = DATE_ADD(?, INTERVAL 10 MINUTE)
       WHERE user_id = ? AND pin_failed_count >= ? AND pin_locked_until IS NULL`,
      { replacements: [now, approver.user_id, PIN_MAX_ATTEMPTS] },
    );
    return;
  }
  const fresh = (await models.User.findByPk(approver.user_id)) || approver;
  if (Number(fresh.pin_failed_count || 0) >= PIN_MAX_ATTEMPTS && !fresh.pin_locked_until) {
    await fresh.update({ pin_locked_until: new Date(now.getTime() + PIN_LOCK_MS) });
  }
};

const resetApproverAttempts = (approver) =>
  approver.update({ pin_failed_count: 0, pin_locked_until: null });

export const approveHere = async (
  models,
  requesterUserId,
  {
    type,
    context = {},
    summary = null,
    approver_user_id,
    pin,
    password,
    invoice_id = null,
    sale_line_id = null,
    product_id = null,
    amount_impact = 0,
  } = {},
  { now = new Date() } = {},
) => {
  assertValidExceptionType(type);

  const approverId = Number(approver_user_id);
  if (!Number.isInteger(approverId) || approverId <= 0) {
    throw new AppError("approver_user_id is required.", 400);
  }
  if (approverId === Number(requesterUserId)) {
    throw new AppError("You cannot approve your own request.", 403);
  }

  const settings = await getRetailSettings(models);
  const method = settings.approvalMethod || "either";

  const hasPin = pin !== undefined && pin !== null && pin !== "";
  const hasPassword = password !== undefined && password !== null && password !== "";

  if (!hasPin && !hasPassword) {
    throw new AppError("A manager PIN or password is required.", 400);
  }
  if (hasPin && method === "password") {
    throw new AppError("PIN approval is disabled; use password.", 400);
  }
  if (hasPassword && method === "pin") {
    throw new AppError("Password approval is disabled; use PIN.", 400);
  }

  assertRequesterWithinLimit(requesterUserId, now);

  const { user: approver, allowed } = await userHasApprovalsDecide(models, approverId);
  if (!approver) {
    throw new AppError("Approver not found or inactive.", 404);
  }
  if (!allowed) {
    throw new AppError("Selected user does not have permission to approve exceptions.", 403);
  }

  if (hasPin && !approver.approval_pin_hash) {
    throw new AppError("Approver has not configured an approval PIN.", 400);
  }

  // Count the attempt first (see reserveApproverAttempt), for the approver and for the requester.
  recordRequesterFailure(requesterUserId, now);
  if (!(await reserveApproverAttempt(models, approver, now))) {
    throw new AppError(
      "Approvals for this manager are temporarily locked after too many failed attempts.",
      423,
    );
  }

  const valid = hasPin
    ? await bcrypt.compare(String(pin), approver.approval_pin_hash)
    : await bcrypt.compare(String(password), approver.password_hash);
  if (!valid) {
    await lockApproverIfLimitReached(models, approver, now);
    throw new AppError(hasPin ? "Invalid approval PIN." : "Invalid approver password.", 401);
  }
  forgetRequesterAttempt(requesterUserId);
  await resetApproverAttempts(approver);

  return runInTransaction(models, async (transaction) => {
    const opts = transaction ? { transaction } : {};
    const exception = await models.CounterException.create(
      {
        type,
        status: "approved",
        invoice_id,
        sale_line_id,
        product_id,
        requested_by: requesterUserId,
        approved_by: approver.user_id,
        new_value: context ?? {},
        amount_impact: Number(amount_impact) || 0,
        summary: summary ? String(summary).slice(0, 500) : null,
        created_at: now,
        resolved_at: now,
      },
      opts,
    );

    const { approval_token, expires_at } = await issueApprovalToken(models, {
      exceptionId: exception.exception_id,
      type,
      approverUserId: approver.user_id,
      requesterUserId,
      context,
      now,
      transaction,
    });

    return {
      approval_token,
      exception_id: exception.exception_id,
      expires_at,
    };
  });
};

export const requestRemoteApproval = async (
  models,
  requesterUserId,
  {
    type,
    context = {},
    summary = null,
    amount_impact = 0,
    invoice_id = null,
    sale_line_id = null,
    product_id = null,
  } = {},
  { tenantDbName = null, now = new Date() } = {},
) => {
  assertValidExceptionType(type);

  const settings = await getRetailSettings(models);
  if (settings.askManagerRemote === false) {
    throw new AppError("Remote manager approval is disabled in retail settings.", 403);
  }

  const expiresAt = new Date(now.getTime() + REQUEST_TTL_MS);
  const exception = await models.CounterException.create({
    type,
    status: "waiting",
    invoice_id,
    sale_line_id,
    product_id,
    requested_by: requesterUserId,
    new_value: context ?? {},
    amount_impact: Number(amount_impact) || 0,
    summary: summary ? String(summary).slice(0, 500) : null,
    expires_at: expiresAt,
    created_at: now,
  });

  if (models.Notification?.create) {
    const approvers = await listApprovers(models);
    const recipients = approvers.filter((a) => Number(a.user_id) !== Number(requesterUserId));
    for (const recipient of recipients) {
      await models.Notification.create({
        user_id: recipient.user_id,
        type: "warning",
        category: "approval",
        title: `Approval needed: ${type}`,
        message: summary || `Counter approval requested (#${exception.exception_id})`,
        payload: {
          exception_id: exception.exception_id,
          type,
          requested_by: requesterUserId,
          amount_impact: Number(amount_impact) || 0,
        },
      });
    }
  }

  emitToTenant(tenantDbName, "approval:requested", {
    exception_id: exception.exception_id,
    type,
    summary: exception.summary,
    requested_by: requesterUserId,
    amount_impact: Number(amount_impact) || 0,
    expires_at: expiresAt,
  });

  return {
    exception_id: exception.exception_id,
    status: exception.status,
    expires_at: expiresAt,
  };
};

export const decideApprovalRequest = async (
  models,
  exceptionId,
  approverUserId,
  { approve },
  { tenantDbName = null, now = new Date() } = {},
) => {
  if (typeof approve !== "boolean") {
    throw new AppError("approve must be a boolean.", 400);
  }

  const { allowed } = await userHasApprovalsDecide(models, approverUserId);
  if (!allowed) {
    throw new AppError("You do not have permission to decide approvals.", 403);
  }

  const exception = await models.CounterException.findByPk(exceptionId);
  if (!exception) {
    throw new AppError("Approval request not found.", 404);
  }
  if (Number(exception.requested_by) === Number(approverUserId)) {
    throw new AppError("You cannot decide your own approval request.", 403);
  }
  if (exception.status !== "waiting") {
    throw new AppError("This approval request has already been decided.", 409);
  }
  if (exception.expires_at && new Date(exception.expires_at) <= now) {
    throw new AppError("This approval request has expired.", 410);
  }

  const result = await runInTransaction(models, async (transaction) => {
    const [affectedRows] = await models.CounterException.update(
      {
        status: approve ? "approved" : "declined",
        approved_by: approverUserId,
        resolved_at: now,
      },
      {
        where: {
          exception_id: exception.exception_id,
          status: "waiting",
          [Op.or]: [{ expires_at: null }, { expires_at: { [Op.gt]: now } }],
        },
        ...(transaction ? { transaction } : {}),
      },
    );

    if (affectedRows !== 1) {
      throw new AppError("This approval request has already been decided or expired.", 409);
    }

    if (!approve) {
      return {
        exception_id: exception.exception_id,
        approved: false,
      };
    }

    const { approval_token, expires_at } = await issueApprovalToken(models, {
      exceptionId: exception.exception_id,
      type: exception.type,
      approverUserId,
      requesterUserId: exception.requested_by,
      context: exception.new_value ?? {},
      now,
      transaction,
    });

    return {
      exception_id: exception.exception_id,
      approved: true,
      approval_token,
      expires_at,
    };
  });

  emitToUser(tenantDbName, exception.requested_by, "approval:decided", result);
  return result;
};

export const recordCounterException = async (
  models,
  userId,
  {
    type,
    context = {},
    summary = null,
    invoice_id = null,
    sale_line_id = null,
    product_id = null,
    amount_impact = 0,
    note = null,
  } = {},
  { now = new Date(), transaction } = {},
) => {
  assertValidExceptionType(type);

  const exception = await models.CounterException.create(
    {
      type,
      status: "recorded",
      invoice_id,
      sale_line_id,
      product_id,
      requested_by: userId,
      new_value: context ?? {},
      amount_impact: Number(amount_impact) || 0,
      summary: summary ? String(summary).slice(0, 500) : null,
      note: note ? String(note).slice(0, 500) : null,
      created_at: now,
    },
    transaction ? { transaction } : {},
  );

  return { exception };
};

export const getApprovalDesk = async (
  models,
  { tab = "waiting", type, from, to, page = 1, limit = 20, now = new Date() } = {},
) => {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const offset = (safePage - 1) * safeLimit;

  if (tab === "to_sort") {
    const res = await getToSortDeskItems(models, { page: safePage, limit: safeLimit });
    return {
      tab: "to_sort",
      total: res.pagination.total,
      page: safePage,
      limit: safeLimit,
      items: res.items,
      pagination: res.pagination,
    };
  }

  const where = {};
  if (tab === "waiting") {
    where.status = "waiting";
    where[Op.or] = [
      { expires_at: null },
      { expires_at: { [Op.gt]: now } },
    ];
  } else if (tab === "records") {
    where.status = { [Op.ne]: "waiting" };
  } else {
    throw new AppError("tab must be 'waiting', 'records', or 'to_sort'.", 400);
  }

  if (type) {
    assertValidExceptionType(type);
    where.type = type;
  }

  if (from || to) {
    where.created_at = {};
    if (from) where.created_at[Op.gte] = new Date(from);
    if (to) where.created_at[Op.lte] = new Date(to);
  }

  const include = [
    {
      model: models.User,
      as: "Requester",
      attributes: ["user_id", "first_name", "last_name", "username"],
      required: false,
    },
    {
      model: models.User,
      as: "Approver",
      attributes: ["user_id", "first_name", "last_name", "username"],
      required: false,
    },
  ];

  const { count, rows } = await models.CounterException.findAndCountAll({
    where,
    include,
    distinct: true,
    col: "exception_id",
    order: [["created_at", "DESC"], ["exception_id", "DESC"]],
    limit: safeLimit,
    offset,
  });

  let totals = undefined;
  if (tab === "records") {
    const allMatching = await models.CounterException.findAll({
      where,
      attributes: ["type", "amount_impact"],
      raw: true,
    });
    const byType = new Map();
    for (const row of allMatching) {
      const entry = byType.get(row.type) || { type: row.type, count: 0, impactCents: 0 };
      entry.count += 1;
      entry.impactCents = addCents(entry.impactCents, toCents(row.amount_impact || 0));
      byType.set(row.type, entry);
    }
    totals = [...byType.values()].map((e) => ({
      type: e.type,
      count: e.count,
      amount_impact: fromCents(e.impactCents),
    }));
  }

  return {
    tab,
    total: count,
    page: safePage,
    limit: safeLimit,
    items: rows,
    ...(totals !== undefined ? { totals } : {}),
  };
};

export const consumeApprovalToken = async (
  models,
  token,
  { type, context = {}, userId, transaction, now = new Date() },
) => {
  if (!token || typeof token !== "string") {
    throw new AppError("Approval token is required.", 403);
  }
  assertValidExceptionType(type);

  const tokenHash = sha256Hex(token);
  const opts = transaction ? { transaction } : {};
  const record = await models.ApprovalToken.findByPk(tokenHash, opts);

  if (!record) {
    throw new AppError("Invalid approval token.", 403);
  }
  if (record.used_at) {
    throw new AppError("Approval token has already been used.", 409);
  }
  if (new Date(record.expires_at) <= now) {
    throw new AppError("Approval token has expired.", 403);
  }
  if (record.action !== type) {
    throw new AppError("Approval token does not match this action type.", 403);
  }
  if (Number(record.requester_user_id) !== Number(userId)) {
    throw new AppError("Approval token was issued for a different user.", 403);
  }
  if (record.context_hash !== hashContext(context)) {
    throw new AppError("Approval token does not match the request context.", 403);
  }

  const [affectedRows] = await models.ApprovalToken.update(
    { used_at: now },
    {
      where: {
        token_hash: tokenHash,
        used_at: null,
        expires_at: { [Op.gt]: now },
      },
      ...(transaction ? { transaction } : {}),
    },
  );
  if (affectedRows !== 1) {
    throw new AppError("Approval token has already been used.", 409);
  }
  record.used_at = now;
  return record;
};
