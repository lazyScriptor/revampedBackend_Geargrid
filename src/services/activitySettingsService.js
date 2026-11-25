import AppError from "../utils/AppError.js";
import { parseJsonField } from "../utils/jsonFields.js";
import {
  DEFAULT_ACTIVITY_THRESHOLDS,
  DEFAULT_REASONS,
  DEFAULT_REVIEW_TAGS,
} from "../config/activityDefaults.js";
import { ACTIVITY_EVENT_TYPES } from "../models/ActivityEvent.js";

const VALID_TYPE_SET = new Set(ACTIVITY_EVENT_TYPES);
const REASON_CATEGORIES = ["discount", "backdate", "refund", "void"];

const normalizeReasonItem = (item) => {
  if (!item || typeof item !== "object") return null;
  const key = String(item.key || "").trim();
  const label_en = String(item.label_en || key).trim();
  const label_si = String(item.label_si || label_en).trim();
  if (!key || !label_en) return null;
  return {
    key,
    label_en,
    label_si,
    active: item.active !== false,
  };
};

export const mergeReasonList = (rawList, defaultList) => {
  const source = Array.isArray(rawList) && rawList.length > 0 ? rawList : defaultList;
  const seen = new Set();
  const out = [];
  for (const raw of source) {
    const item = normalizeReasonItem(raw);
    if (!item || seen.has(item.key)) continue;
    seen.add(item.key);
    if (item.key === "other") item.active = true;
    out.push(item);
  }
  const otherDefault = defaultList.find((d) => d.key === "other") || {
    key: "other",
    label_en: "Other",
    label_si: "වෙනත්",
    active: true,
  };
  if (!seen.has("other")) {
    out.push({ ...otherDefault });
  } else {
    // Keep "other" at the end
    const idx = out.findIndex((i) => i.key === "other");
    if (idx >= 0 && idx !== out.length - 1) {
      const [otherItem] = out.splice(idx, 1);
      out.push(otherItem);
    }
  }
  return out;
};

export const mergeReviewTagList = (rawList, defaultList) => {
  const source = Array.isArray(rawList) && rawList.length > 0 ? rawList : defaultList;
  const seen = new Set();
  const out = [];
  for (const raw of source) {
    const item = normalizeReasonItem(raw);
    if (!item || seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
  }
  return out;
};

export const mergeActivitySettings = (customSettings = {}) => {
  const custom = parseJsonField(customSettings, {});
  const rawAct = parseJsonField(custom.activity, {});
  const rawReasons = parseJsonField(custom.reasons, {});
  const rawTags = parseJsonField(custom.review_tags, {});
  const rawRoles = parseJsonField(custom.activity_roles, {});

  const activity = {
    discountHighPct: Math.max(0, Number(rawAct.discountHighPct ?? DEFAULT_ACTIVITY_THRESHOLDS.discountHighPct) || 0),
    discountHighAmount: Math.max(0, Number(rawAct.discountHighAmount ?? DEFAULT_ACTIVITY_THRESHOLDS.discountHighAmount) || 0),
    backdateHighDays: Math.max(0, Number(rawAct.backdateHighDays ?? DEFAULT_ACTIVITY_THRESHOLDS.backdateHighDays) || 0),
    refundHighAmount: Math.max(0, Number(rawAct.refundHighAmount ?? DEFAULT_ACTIVITY_THRESHOLDS.refundHighAmount) || 0),
  };

  const reasons = {};
  for (const cat of REASON_CATEGORIES) {
    reasons[cat] = mergeReasonList(rawReasons[cat], DEFAULT_REASONS[cat]);
  }

  const review_tags = {
    positive: mergeReviewTagList(rawTags.positive, DEFAULT_REVIEW_TAGS.positive),
    negative: mergeReviewTagList(rawTags.negative, DEFAULT_REVIEW_TAGS.negative),
  };

  const activity_roles = {};
  if (rawRoles && typeof rawRoles === "object") {
    for (const [roleId, rule] of Object.entries(rawRoles)) {
      if (!rule || typeof rule !== "object") continue;
      const types = Array.isArray(rule.types)
        ? [...new Set(rule.types.map(String).filter((t) => VALID_TYPE_SET.has(t)))]
        : [...ACTIVITY_EVENT_TYPES];
      activity_roles[String(roleId)] = {
        types,
        see_amounts: rule.see_amounts !== false,
      };
    }
  }

  return { activity, reasons, review_tags, activity_roles };
};

export const getActivitySettings = async (models, { transaction } = {}) => {
  const config = models?.TenantConfig?.findOne
    ? await models.TenantConfig.findOne({ transaction })
    : null;
  const custom = parseJsonField(config?.custom_settings, {});
  return {
    ...mergeActivitySettings(custom),
    timezone: config?.timezone || "Asia/Colombo",
    business_hours:
      parseJsonField(custom?.phone_assistant, {})?.call_logging?.business_hours || {
        from: "08:00",
        to: "18:00",
      },
  };
};

export const updateActivitySettings = async (models, payload = {}) => {
  const config = await models.TenantConfig.findOne();
  if (!config) throw new AppError("Tenant config missing.", 500);
  const custom = parseJsonField(config.custom_settings, {});
  const current = mergeActivitySettings(custom);

  const nextCustom = { ...custom };

  if (payload.activity && typeof payload.activity === "object") {
    for (const k of ["discountHighPct", "discountHighAmount", "backdateHighDays", "refundHighAmount"]) {
      if (payload.activity[k] !== undefined) {
        const val = Number(payload.activity[k]);
        if (!Number.isFinite(val) || val < 0) {
          throw new AppError(`Invalid threshold for ${k}.`, 400);
        }
      }
    }
    nextCustom.activity = {
      ...current.activity,
      ...Object.fromEntries(
        ["discountHighPct", "discountHighAmount", "backdateHighDays", "refundHighAmount"]
          .filter((k) => payload.activity[k] !== undefined)
          .map((k) => [k, Number(payload.activity[k])]),
      ),
    };
  }

  if (payload.reasons && typeof payload.reasons === "object") {
    const nextReasons = { ...current.reasons };
    for (const cat of REASON_CATEGORIES) {
      if (payload.reasons[cat] !== undefined) {
        if (!Array.isArray(payload.reasons[cat])) {
          throw new AppError(`reasons.${cat} must be an array.`, 400);
        }
        nextReasons[cat] = mergeReasonList(payload.reasons[cat], DEFAULT_REASONS[cat]);
      }
    }
    nextCustom.reasons = nextReasons;
  }

  if (payload.review_tags && typeof payload.review_tags === "object") {
    nextCustom.review_tags = {
      positive:
        payload.review_tags.positive !== undefined
          ? mergeReviewTagList(payload.review_tags.positive, DEFAULT_REVIEW_TAGS.positive)
          : current.review_tags.positive,
      negative:
        payload.review_tags.negative !== undefined
          ? mergeReviewTagList(payload.review_tags.negative, DEFAULT_REVIEW_TAGS.negative)
          : current.review_tags.negative,
    };
  }

  if (payload.activity_roles && typeof payload.activity_roles === "object") {
    const nextRoles = { ...current.activity_roles };
    for (const [roleId, rule] of Object.entries(payload.activity_roles)) {
      if (rule === null) {
        delete nextRoles[String(roleId)];
        continue;
      }
      if (!rule || typeof rule !== "object") continue;
      const types = Array.isArray(rule.types)
        ? [...new Set(rule.types.map(String).filter((t) => VALID_TYPE_SET.has(t)))]
        : [...ACTIVITY_EVENT_TYPES];
      nextRoles[String(roleId)] = {
        types,
        see_amounts: rule.see_amounts !== false,
      };
    }
    nextCustom.activity_roles = nextRoles;
  }

  await config.update({ custom_settings: nextCustom });
  return getActivitySettings(models);
};

/**
 * Validate a reason payload `{ key, note? }` against the shop's configured reason list.
 * Throws 400 with code `reason_required` when missing, unknown, or `other` lacks a note.
 */
export const validateReason = async (models, category, reasonInput, { transaction } = {}) => {
  if (!reasonInput || typeof reasonInput !== "object" || !String(reasonInput.key || "").trim()) {
    throw new AppError("Please select a reason.", 400, "reason_required");
  }
  const key = String(reasonInput.key).trim();
  const note = String(reasonInput.note || "").trim().slice(0, 500);
  if (key === "other" && !note) {
    throw new AppError("Please enter a short note for Other.", 400, "reason_required");
  }

  const { reasons } = await getActivitySettings(models, { transaction });
  const list = reasons[category] || DEFAULT_REASONS[category] || [];
  const match = list.find((item) => item.key === key && item.active !== false);
  if (!match && key !== "other") {
    throw new AppError("Selected reason is not valid.", 400, "reason_required");
  }

  return {
    key,
    note: note || null,
    label_en: match?.label_en || (key === "other" ? "Other" : key),
    label_si: match?.label_si || (key === "other" ? "වෙනත්" : key),
  };
};
