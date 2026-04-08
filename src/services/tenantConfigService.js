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
