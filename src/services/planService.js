// Plans: what each tier includes, edited in the super admin console and enforced on every request.
//
// This guards a live system, so reading a plan must never be what takes a shop down: if the master
// database can't answer, the request goes through (protect() treats subscription status the same way).
import { Op } from "sequelize";
import { getMasterModels } from "../models/master/index.js";
import AppError from "../utils/AppError.js";
import { DEFAULT_PLANS, FEATURE_GROUPS, LIMIT_KEYS, TIERS, effectivePlan, normalizePlans } from "../config/planCatalog.js";

const CONFIG_KEY = "plans";
const CACHE_MS = 30 * 1000;

const parse = (v) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

let plansCache = null;
const tenantCache = new Map();

export const clearPlanCache = () => {
  plansCache = null;
  tenantCache.clear();
};

const readPlans = async () => {
  if (plansCache && Date.now() - plansCache.at < CACHE_MS) return plansCache.value;
  const { PlatformConfig } = getMasterModels();
  const row = await PlatformConfig.findByPk(CONFIG_KEY);
  const stored = row ? parse(row.config_value) : null;
  const value = { version: stored?.version ?? 0, plans: normalizePlans(stored?.plans ?? DEFAULT_PLANS), updated_at: stored?.updated_at ?? null };
  plansCache = { at: Date.now(), value };
  return value;
};

/** For the console: the plans plus the catalog its screen is drawn from. */
export const getPlansForEditor = async () => {
  const { version, plans, updated_at } = await readPlans();
  return { tiers: TIERS, groups: FEATURE_GROUPS, limit_keys: LIMIT_KEYS, plans, version, updated_at };
};

export const savePlans = async ({ plans, version } = {}) => {
  if (!plans || typeof plans !== "object") throw new AppError("Plans are required.", 400);
  clearPlanCache();
  const current = await readPlans();
  // Two people editing: the second save must not silently undo the first.
  if (Number(version) !== current.version) throw new AppError("These plans were changed by someone else. Reload them and try again.", 409);
  const { PlatformConfig } = getMasterModels();
  const value = { version: current.version + 1, plans: normalizePlans(plans), updated_at: new Date().toISOString() };
  await PlatformConfig.upsert({ config_key: CONFIG_KEY, config_value: value, updatedAt: new Date() });
  clearPlanCache();
  return getPlansForEditor();
};

/** A shop's plan, or null if it can't be worked out (the caller then lets the request through). */
export const getTenantPlan = async (dbName) => {
  if (!dbName) return null;
  const hit = tenantCache.get(dbName);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  try {
    const { Tenant } = getMasterModels();
    const [{ plans }, tenant] = await Promise.all([
      readPlans(),
      Tenant.findOne({ where: { db_name: dbName }, attributes: ["tier", "feature_flags"] }),
    ]);
    if (!tenant) return null;
    const flags = parse(tenant.feature_flags) ?? {};
    const value = effectivePlan(plans, tenant.tier, flags.plan_overrides);
    tenantCache.set(dbName, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.error("plans: could not read plan, allowing the request", err?.message);
    return null;
  }
};

export const countUsage = async (models) => {
  const [max_equipment, max_users, max_locations] = await Promise.all([
    models.Equipment.count({ where: { is_archived: false } }),
    models.User.count({ where: { is_active: true } }),
    models.Warehouse.count(),
  ]);
  return { max_equipment, max_users, max_locations };
};

const LIMIT_WORDS = {
  max_equipment: ["machine", "machines"],
  max_users: ["active staff account", "active staff accounts"],
  max_locations: ["location", "locations"],
};

/** Refuses an action that would take a shop over a limit. Only adding is ever blocked. */
export const assertWithinLimit = async (models, dbName, limitKey, adding) => {
  if (!(adding > 0)) return;
  const plan = await getTenantPlan(dbName);
  const limit = plan?.limits?.[limitKey];
  if (limit === null || limit === undefined) return;
  const usage = (await countUsage(models))[limitKey];
  if (usage + adding > limit) {
    throw new AppError(`Your ${plan.tier} plan includes up to ${limit} ${LIMIT_WORDS[limitKey][limit === 1 ? 0 : 1]}, and this shop has ${usage}. Contact GearGrid to upgrade.`, 403);
  }
};

/**
 * Rows a spreadsheet import may add under the machine limit. Rows updating a machine that already
 * exists always go through; the rest are cut off at the limit and reported as skipped.
 */
export const capImportedMachines = async (models, dbName, rows) => {
  const plan = await getTenantPlan(dbName);
  const limit = plan?.limits?.max_equipment;
  if (limit === null || limit === undefined) return { allowed: rows, refused: [], limit: null, tier: plan?.tier };
  const serials = rows.map((r) => r.serial_number).filter(Boolean);
  const existing = serials.length
    ? await models.Equipment.findAll({ where: { serial_number: { [Op.in]: serials } }, attributes: ["serial_number"], raw: true })
    : [];
  const known = new Set(existing.map((e) => String(e.serial_number).toLowerCase()));
  let room = Math.max(0, limit - (await models.Equipment.count({ where: { is_archived: false } })));
  const allowed = [];
  const refused = [];
  for (const row of rows) {
    if (row.serial_number && known.has(String(row.serial_number).toLowerCase())) allowed.push(row);
    else if (room > 0) {
      room--;
      allowed.push(row);
    } else refused.push(row);
  }
  return { allowed, refused, limit, tier: plan.tier };
};
