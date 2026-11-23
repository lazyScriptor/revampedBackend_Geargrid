import AppError from "../../utils/AppError.js";
import { parseJsonField } from "../../utils/jsonFields.js";
import { COUNTER_EXCEPTION_TYPES } from "../../models/CounterException.js";

export const EXCEPTION_POLICY_MODES = ["off", "record", "approve"];
export const NEGATIVE_STOCK_MODES = ["warn", "block"];
export const APPROVAL_METHODS = ["pin", "password", "either"];
export const APPROVAL_GRANT_MINUTES = [0, 1, 5, 10];
export const ALLOWED_BASE_UNITS = [
  "pcs",
  "kg",
  "g",
  "m",
  "ft",
  "L",
  "bag",
  "box",
  "roll",
  "set",
  "sheet",
  "pair",
];
export const DECIMAL_BASE_UNITS = new Set(["kg", "g", "m", "ft", "L"]);
export const DEFAULT_PACK_UNITS = ["box", "coil", "length", "tin", "pack", "carton", "bundle"];

export const DEFAULT_EXCEPTION_POLICIES = {
  unlisted_item: "record",
  price_change: "approve",
  discount_over_limit: "approve",
  below_cost: "record",
  negative_stock: "approve",
  return_no_bill: "approve",
  line_removed: "approve",
  bill_void_after_print: "approve",
  credit_over_limit: "approve",
  backdated_bill: "record",
  drawer_open: "record",
};

export const DEFAULT_RETAIL_SETTINGS = {
  negativeStock: "warn",
  exceptions: { ...DEFAULT_EXCEPTION_POLICIES },
  approvalMethod: "either",
  approvalGrantMinutes: 0,
  askManagerRemote: true,
  booksClosedUntil: null,
  discountLimitPct: 10,
  quickPad: [],
  namePattern: "{brand} {item} {variant}{unit}",
  codePrefix: "HW-",
  units: {
    base: [...ALLOWED_BASE_UNITS],
    pack: [...DEFAULT_PACK_UNITS],
  },
  defaultWarehouseId: null,
  showContractorPrice: true,
  belowCostWarning: true,
  receiptFooter: "",
};

const normalizeStoredExceptions = (raw) => {
  const out = { ...DEFAULT_EXCEPTION_POLICIES };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const type of COUNTER_EXCEPTION_TYPES) {
      if (EXCEPTION_POLICY_MODES.includes(raw[type])) {
        out[type] = raw[type];
      }
    }
  }
  return out;
};

export const mergeRetailSettings = (stored) => {
  const raw = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  return {
    negativeStock: NEGATIVE_STOCK_MODES.includes(raw.negativeStock)
      ? raw.negativeStock
      : DEFAULT_RETAIL_SETTINGS.negativeStock,
    exceptions: normalizeStoredExceptions(raw.exceptions),
    approvalMethod: APPROVAL_METHODS.includes(raw.approvalMethod)
      ? raw.approvalMethod
      : DEFAULT_RETAIL_SETTINGS.approvalMethod,
    approvalGrantMinutes: APPROVAL_GRANT_MINUTES.includes(Number(raw.approvalGrantMinutes))
      ? Number(raw.approvalGrantMinutes)
      : DEFAULT_RETAIL_SETTINGS.approvalGrantMinutes,
    askManagerRemote:
      typeof raw.askManagerRemote === "boolean"
        ? raw.askManagerRemote
        : DEFAULT_RETAIL_SETTINGS.askManagerRemote,
    booksClosedUntil:
      typeof raw.booksClosedUntil === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.booksClosedUntil)
        ? raw.booksClosedUntil
        : null,
    discountLimitPct:
      typeof raw.discountLimitPct === "number" &&
      Number.isFinite(raw.discountLimitPct) &&
      raw.discountLimitPct >= 0 &&
      raw.discountLimitPct <= 100
        ? raw.discountLimitPct
        : DEFAULT_RETAIL_SETTINGS.discountLimitPct,
    quickPad: Array.isArray(raw.quickPad)
      ? raw.quickPad.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [],
    namePattern:
      typeof raw.namePattern === "string" && raw.namePattern.trim()
        ? raw.namePattern.trim().slice(0, 120)
        : DEFAULT_RETAIL_SETTINGS.namePattern,
    codePrefix:
      typeof raw.codePrefix === "string" && raw.codePrefix.trim()
        ? raw.codePrefix.trim().slice(0, 12)
        : DEFAULT_RETAIL_SETTINGS.codePrefix,
    units: {
      base: Array.isArray(raw.units?.base) && raw.units.base.length > 0
        ? raw.units.base.map((u) => String(u).trim()).filter(Boolean)
        : [...ALLOWED_BASE_UNITS],
      pack: Array.isArray(raw.units?.pack) && raw.units.pack.length > 0
        ? raw.units.pack.map((u) => String(u).trim()).filter(Boolean)
        : [...DEFAULT_PACK_UNITS],
    },
    defaultWarehouseId:
      Number.isInteger(Number(raw.defaultWarehouseId)) && Number(raw.defaultWarehouseId) > 0
        ? Number(raw.defaultWarehouseId)
        : null,
    showContractorPrice:
      typeof raw.showContractorPrice === "boolean"
        ? raw.showContractorPrice
        : DEFAULT_RETAIL_SETTINGS.showContractorPrice,
    belowCostWarning:
      typeof raw.belowCostWarning === "boolean"
        ? raw.belowCostWarning
        : DEFAULT_RETAIL_SETTINGS.belowCostWarning,
    receiptFooter:
      typeof raw.receiptFooter === "string"
        ? raw.receiptFooter.slice(0, 500)
        : DEFAULT_RETAIL_SETTINGS.receiptFooter,
  };
};

export const validateRetailSettingsPatch = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("Settings payload must be a JSON object.", 400);
  }

  const patch = {};

  if (body.negativeStock !== undefined) {
    if (!NEGATIVE_STOCK_MODES.includes(body.negativeStock)) {
      throw new AppError("negativeStock must be 'warn' or 'block'.", 400);
    }
    patch.negativeStock = body.negativeStock;
  }

  if (body.approvalMethod !== undefined) {
    if (!APPROVAL_METHODS.includes(body.approvalMethod)) {
      throw new AppError("approvalMethod must be 'pin', 'password', or 'either'.", 400);
    }
    patch.approvalMethod = body.approvalMethod;
  }

  if (body.approvalGrantMinutes !== undefined) {
    const mins = Number(body.approvalGrantMinutes);
    if (!APPROVAL_GRANT_MINUTES.includes(mins)) {
      throw new AppError("approvalGrantMinutes must be 0, 1, 5, or 10.", 400);
    }
    patch.approvalGrantMinutes = mins;
  }

  if (body.askManagerRemote !== undefined) {
    if (typeof body.askManagerRemote !== "boolean") {
      throw new AppError("askManagerRemote must be a boolean.", 400);
    }
    patch.askManagerRemote = body.askManagerRemote;
  }

  if (body.booksClosedUntil !== undefined) {
    if (body.booksClosedUntil === null || body.booksClosedUntil === "") {
      patch.booksClosedUntil = null;
    } else if (
      typeof body.booksClosedUntil === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.booksClosedUntil)
    ) {
      patch.booksClosedUntil = body.booksClosedUntil;
    } else {
      throw new AppError("booksClosedUntil must be a YYYY-MM-DD date or null.", 400);
    }
  }

  if (body.discountLimitPct !== undefined) {
    const pct = Number(body.discountLimitPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new AppError("discountLimitPct must be a number between 0 and 100.", 400);
    }
    patch.discountLimitPct = pct;
  }

  if (body.exceptions !== undefined) {
    if (!body.exceptions || typeof body.exceptions !== "object" || Array.isArray(body.exceptions)) {
      throw new AppError("exceptions must be an object mapping exception types to modes.", 400);
    }
    const nextExceptions = {};
    for (const [k, v] of Object.entries(body.exceptions)) {
      if (!COUNTER_EXCEPTION_TYPES.includes(k)) {
        throw new AppError(`Unknown exception type: ${k}`, 400);
      }
      if (!EXCEPTION_POLICY_MODES.includes(v)) {
        throw new AppError(`Invalid mode for ${k}: must be 'off', 'record', or 'approve'.`, 400);
      }
      nextExceptions[k] = v;
    }
    patch.exceptions = nextExceptions;
  }

  if (body.quickPad !== undefined) {
    if (!Array.isArray(body.quickPad)) {
      throw new AppError("quickPad must be an array of product IDs.", 400);
    }
    const ids = body.quickPad.map(Number);
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new AppError("quickPad must contain positive integer product IDs.", 400);
    }
    patch.quickPad = ids;
  }

  if (body.namePattern !== undefined) {
    if (typeof body.namePattern !== "string" || !body.namePattern.trim()) {
      throw new AppError("namePattern must be a non-empty string.", 400);
    }
    if (body.namePattern.trim().length > 120) {
      throw new AppError("namePattern is too long (max 120 characters).", 400);
    }
    patch.namePattern = body.namePattern.trim();
  }

  if (body.codePrefix !== undefined) {
    if (typeof body.codePrefix !== "string" || !body.codePrefix.trim()) {
      throw new AppError("codePrefix must be a non-empty string.", 400);
    }
    if (body.codePrefix.trim().length > 12) {
      throw new AppError("codePrefix is too long (max 12 characters).", 400);
    }
    patch.codePrefix = body.codePrefix.trim();
  }

  if (body.units !== undefined) {
    if (!body.units || typeof body.units !== "object" || Array.isArray(body.units)) {
      throw new AppError("units must be an object with base and/or pack arrays.", 400);
    }
    const cleanList = (arr, label) => {
      if (!Array.isArray(arr) || arr.length === 0) {
        throw new AppError(`units.${label} must be a non-empty array of strings.`, 400);
      }
      const out = arr.map((u) => String(u || "").trim()).filter(Boolean);
      if (out.length !== arr.length || out.some((u) => u.length > 20)) {
        throw new AppError(`units.${label} entries must be non-empty strings (max 20 chars).`, 400);
      }
      return [...new Set(out)];
    };
    patch.units = {
      base: body.units.base !== undefined ? cleanList(body.units.base, "base") : [...ALLOWED_BASE_UNITS],
      pack: body.units.pack !== undefined ? cleanList(body.units.pack, "pack") : [...DEFAULT_PACK_UNITS],
    };
  }

  if (body.defaultWarehouseId !== undefined) {
    if (body.defaultWarehouseId === null || body.defaultWarehouseId === "") {
      patch.defaultWarehouseId = null;
    } else {
      const id = Number(body.defaultWarehouseId);
      if (!Number.isInteger(id) || id <= 0) {
        throw new AppError("defaultWarehouseId must be a positive integer or null.", 400);
      }
      patch.defaultWarehouseId = id;
    }
  }

  if (body.showContractorPrice !== undefined) {
    if (typeof body.showContractorPrice !== "boolean") {
      throw new AppError("showContractorPrice must be a boolean.", 400);
    }
    patch.showContractorPrice = body.showContractorPrice;
  }

  if (body.belowCostWarning !== undefined) {
    if (typeof body.belowCostWarning !== "boolean") {
      throw new AppError("belowCostWarning must be a boolean.", 400);
    }
    patch.belowCostWarning = body.belowCostWarning;
  }

  if (body.receiptFooter !== undefined) {
    if (typeof body.receiptFooter !== "string") {
      throw new AppError("receiptFooter must be a string.", 400);
    }
    if (body.receiptFooter.length > 500) {
      throw new AppError("receiptFooter is too long (max 500 characters).", 400);
    }
    patch.receiptFooter = body.receiptFooter;
  }

  return patch;
};

export const getRetailSettings = async (models) => {
  const config = await models.TenantConfig.findOne();
  const custom = parseJsonField(config?.custom_settings) || {};
  return mergeRetailSettings(custom.retail);
};

export const updateRetailSettings = async (models, body) => {
  const patch = validateRetailSettingsPatch(body);

  let config = await models.TenantConfig.findOne();
  if (!config) {
    config = await models.TenantConfig.create({ business_display_name: "My Rental Co" });
  }
  const custom = parseJsonField(config.custom_settings) || {};
  const current = mergeRetailSettings(custom.retail);

  const nextRetail = {
    ...current,
    ...patch,
    exceptions: {
      ...current.exceptions,
      ...(patch.exceptions || {}),
    },
  };

  await config.update({
    custom_settings: {
      ...custom,
      retail: nextRetail,
    },
  });

  return nextRetail;
};
