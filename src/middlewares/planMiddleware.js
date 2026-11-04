// Plan checks for routes. Separate from requirePermission on purpose: shop admins skip permission
// checks, but a plan applies to everyone in the shop, admins included.
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { assertWithinLimit, getTenantPlan } from "../services/planService.js";
import AppError from "../utils/AppError.js";

const refuse = (plan) => new AppError(`This isn't included in your ${plan.tier} plan. Contact GearGrid to upgrade.`, 403);

/** Run after protect. Passes when the shop's plan includes any of the keys. */
export const requireFeature = (...keys) => async (req, res, next) => {
  const plan = await getTenantPlan(req.user?.tenantDbName);
  if (!plan || keys.some((k) => plan.features[k] !== false)) return next();
  next(refuse(plan));
};

/** Run after protect. `adding(req)` says how many the request adds; zero or less is always fine. */
export const enforceLimit = (limitKey, adding = () => 1) => async (req, res, next) => {
  try {
    const dbName = req.user?.tenantDbName;
    if (!dbName) return next();
    const models = initTenantModels(getCachedTenantConnection(dbName));
    await assertWithinLimit(models, dbName, limitKey, adding(req));
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * A machine returned damaged goes to the repair queue, and only Maintenance can bring it back into
 * stock. Without Maintenance it would be stranded, so the return is refused before anything changes.
 */
export const refuseDamagedWithoutMaintenance = async (req, res, next) => {
  const lines = Array.isArray(req.body?.lines_returned) ? req.body.lines_returned : [];
  if (!lines.some((l) => (parseInt(l?.defective_qty) || 0) > 0)) return next();
  const plan = await getTenantPlan(req.user?.tenantDbName);
  if (plan && plan.features.maintenance === false) {
    return next(new AppError(`Damaged returns need Maintenance, which isn't included in your ${plan.tier} plan. Return the machine as good and add a damage fee.`, 403));
  }
  next();
};
