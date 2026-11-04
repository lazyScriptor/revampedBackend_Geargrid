// Forgotten passwords: a 6-digit code, by email or handed over by an admin on WhatsApp.
//
// The public steps give the same answer whether or not an account exists, so they can't be used to
// find out who has one. Only a keyed hash of a code is stored, and a code dies after 5 wrong tries.
import bcrypt from "bcrypt";
import crypto from "crypto";
import { Op } from "sequelize";
import { getTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { getMasterModels } from "../models/master/index.js";
import AppError from "../utils/AppError.js";
import { sendPasswordChangedEmail, sendResetCodeEmail } from "./emailService.js";

const EMAIL_MINUTES = 10;
const ADMIN_MINUTES = 30;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_WINDOW = 3;
const WINDOW_MS = 15 * 60 * 1000;

const hashCode = (globalUserId, code) => crypto.createHmac("sha256", process.env.JWT_SECRET || "").update(`${globalUserId}:${code}`).digest("hex");
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

/** Find a login by what someone types: an email has an @, anything else is a username. */
export const findGlobalUser = (identifier) => {
  const value = String(identifier ?? "").trim();
  if (!value) return null;
  const { GlobalUser } = getMasterModels();
  return GlobalUser.findOne({ where: value.includes("@") ? { email: value } : { username: value } });
};

const issueCode = async (globalUser, channel, minutes) => {
  const { PasswordResetCode } = getMasterModels();
  const code = newCode();
  // Only the newest code works.
  await PasswordResetCode.update({ used_at: new Date() }, { where: { global_user_id: globalUser.global_user_id, used_at: null } });
  await PasswordResetCode.create({
    global_user_id: globalUser.global_user_id,
    code_hash: hashCode(globalUser.global_user_id, code),
    channel,
    expires_at: new Date(Date.now() + minutes * 60000),
  });
  return code;
};

/** Public step 1. Always ends the same way for the caller; failures only reach the server log. */
export const requestResetCode = async (identifier) => {
  try {
    const user = await findGlobalUser(identifier);
    if (!user) return;
    const { PasswordResetCode } = getMasterModels();
    const recent = await PasswordResetCode.count({
      where: { global_user_id: user.global_user_id, channel: "email", createdAt: { [Op.gte]: new Date(Date.now() - WINDOW_MS) } },
    });
    if (recent >= MAX_CODES_PER_WINDOW) return;
    const code = await issueCode(user, "email", EMAIL_MINUTES);
    await sendResetCodeEmail({ to: user.email, code, minutes: EMAIL_MINUTES });
  } catch (err) {
    console.error("password reset: could not send a code", err?.message);
  }
};

const tenantModelsFor = async (globalUser) => {
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(globalUser.target_tenant_id);
  if (!tenant) return null;
  return initTenantModels(await getTenantConnection(tenant.db_name, tenant.db_user, tenant.encrypted_db_pass, tenant.db_host));
};

const BAD_CODE = "That code is wrong or has expired. Ask for a new one.";

/** Public step 2. */
export const resetPasswordWithCode = async ({ identifier, code, newPassword }) => {
  if (typeof newPassword !== "string" || newPassword.length < 8) throw new AppError("The new password must be at least 8 characters.", 400);
  const user = await findGlobalUser(identifier);
  if (!user) throw new AppError(BAD_CODE, 400);
  const { PasswordResetCode } = getMasterModels();
  const row = await PasswordResetCode.findOne({
    where: { global_user_id: user.global_user_id, used_at: null, expires_at: { [Op.gt]: new Date() } },
    order: [["code_id", "DESC"]],
  });
  if (!row) throw new AppError(BAD_CODE, 400);
  if (!sameHash(row.code_hash, hashCode(user.global_user_id, String(code ?? "").trim()))) {
    const attempts = row.attempts + 1;
    await row.update(attempts >= MAX_ATTEMPTS ? { attempts, used_at: new Date() } : { attempts });
    throw new AppError(BAD_CODE, 400);
  }

  const models = await tenantModelsFor(user);
  const tenantUser = models && (await models.User.findOne({ where: { email: user.email, is_active: true } }));
  if (!tenantUser) throw new AppError(BAD_CODE, 400);

  const password_hash = await bcrypt.hash(newPassword, 12);
  await tenantUser.update({ password_hash, password_changed_at: new Date(), must_change_password: false });
  await user.update({ password_hash });
  await PasswordResetCode.update({ used_at: new Date() }, { where: { global_user_id: user.global_user_id, used_at: null } });
  sendPasswordChangedEmail({ to: user.email }).catch(() => {});
};

/** An admin hands a code over themselves, on WhatsApp. Lasts longer, as a person is passing it on. */
export const issueAdminResetCode = async (email) => {
  const { GlobalUser } = getMasterModels();
  const user = await GlobalUser.findOne({ where: { email } });
  if (!user) throw new AppError("This user can't log in yet, so there is no password to reset.", 404);
  const code = await issueCode(user, "admin", ADMIN_MINUTES);
  return { code, minutes: ADMIN_MINUTES };
};
