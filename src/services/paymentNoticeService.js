// The default wording and timers for overdue shops, edited in the super admin console.
import { getMasterModels } from "../models/master/index.js";
import { normalizeNoticeDefaults, resolveNotice } from "../config/paymentNotice.js";

const CONFIG_KEY = "payment_notice_defaults";
const parse = (v) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

export const getNoticeDefaults = async () => {
  const { PlatformConfig } = getMasterModels();
  const row = await PlatformConfig.findByPk(CONFIG_KEY);
  return normalizeNoticeDefaults(row ? parse(row.config_value) : null);
};

export const saveNoticeDefaults = async (input) => {
  const { PlatformConfig } = getMasterModels();
  const value = normalizeNoticeDefaults(input);
  await PlatformConfig.upsert({ config_key: CONFIG_KEY, config_value: value, updatedAt: new Date() });
  return value;
};

/** The shop's notice, or null when it isn't overdue or it can't be worked out right now. */
export const getTenantNotice = async (dbName) => {
  try {
    const { Tenant } = getMasterModels();
    const tenant = await Tenant.findOne({
      where: { db_name: dbName },
      attributes: ["subscription_status", "feature_flags", "display_name", "monthly_rate", "next_billing_date"],
    });
    if (!tenant || tenant.subscription_status !== "Overdue") return null;
    return resolveNotice({
      status: tenant.subscription_status,
      notice: parse(tenant.feature_flags)?.payment_notice,
      defaults: await getNoticeDefaults(),
      displayName: tenant.display_name,
      monthlyRate: tenant.monthly_rate,
      nextBillingDate: tenant.next_billing_date,
    });
  } catch (err) {
    console.error("payment notice: could not read", err?.message);
    return null;
  }
};
