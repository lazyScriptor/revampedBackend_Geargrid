import AppError from "../utils/AppError.js";

export const getTenantConfig = async (models) => {
  // Grab the first config row (there should only be one per tenant DB)
  let config = await models.TenantConfig.findOne();

  // Failsafe: If for some reason it doesn't exist, return defaults
  if (!config) {
    config = {
      business_display_name: "My Rental Co",
      primary_color: "#1976d2",
      currency_code: "LKR",
      timezone: "Asia/Colombo",
    };
  }
  return config;
};

export const updateTenantConfig = async (models, updateData) => {
  let config = await models.TenantConfig.findOne();

  if (!config) {
    // If it doesn't exist yet, create it
    return await models.TenantConfig.create(updateData);
  }

  // Update existing
  await config.update(updateData);
  return config;
};

// ─── Bill details (shop phone / address / email printed on receipts) ─────────
// Stored in TENANT_CONFIG.custom_settings next to other settings (whatsapp…),
// so updates merge instead of replacing the whole JSON column.
const BILL_FIELDS = { phone: 30, address: 200, email: 120 };

const parseJsonObject = (v) => {
  if (!v) return {};
  if (typeof v === "object") return v;
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const getBillDetails = async (models) => {
  const config = await models.TenantConfig.findOne();
  const custom = parseJsonObject(config?.custom_settings);
  return Object.fromEntries(
    Object.keys(BILL_FIELDS).map((k) => [k, typeof custom[k] === "string" ? custom[k] : ""]),
  );
};

export const updateBillDetails = async (models, body = {}) => {
  const patch = {};
  for (const [field, max] of Object.entries(BILL_FIELDS)) {
    if (body[field] === undefined) continue;
    const value = String(body[field] ?? "").trim();
    if (value.length > max) throw new AppError(`${field} is too long (max ${max} characters).`, 400);
    patch[field] = value;
  }
  if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) {
    throw new AppError("Email address is not valid.", 400);
  }

  let config = await models.TenantConfig.findOne();
  if (!config) config = await models.TenantConfig.create({ business_display_name: "My Rental Co" });
  const custom = parseJsonObject(config.custom_settings);
  await config.update({ custom_settings: { ...custom, ...patch } });
  return getBillDetails(models);
};
