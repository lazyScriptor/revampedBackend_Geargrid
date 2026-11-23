/**
 * Integer-cents money helpers for the retail module.
 * All retail sums and splits are computed in integer cents to avoid IEEE-754 float drift.
 */

const assertSafeInt = (value, name = "cents") => {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new TypeError(`${name} must be a finite integer, got ${value}`);
  }
  return n;
};

/**
 * Convert a rupee amount (number or numeric string) into integer cents,
 * rounding half-away-from-zero to avoid binary float representation bugs (e.g. 1.005 -> 101).
 */
export const toCents = (rupees) => {
  if (rupees === null || rupees === undefined || rupees === "") return 0;
  if (typeof rupees === "number") {
    if (!Number.isFinite(rupees)) {
      throw new TypeError(`rupees must be finite, got ${rupees}`);
    }
    if (Object.is(rupees, -0) || rupees === 0) return 0;
  }

  const raw = String(rupees).trim();
  if (!raw) return 0;

  // Handle scientific notation or standard decimal strings
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    throw new TypeError(`Invalid rupee amount: ${rupees}`);
  }
  if (num === 0) return 0;

  // Use string decimal parsing when formatted as a plain decimal so 1.005 -> 101 exactly
  const match = raw.match(/^([+-])?(\d+)(?:\.(\d+))?$/);
  if (match) {
    const sign = match[1] === "-" ? -1 : 1;
    const whole = Number(match[2]);
    const frac = (match[3] || "").padEnd(3, "0");
    const baseCents = whole * 100 + Number(frac.slice(0, 2));
    const thirdDigit = Number(frac[2]);
    const roundUp = thirdDigit >= 5 ? 1 : 0;
    const result = sign * (baseCents + roundUp);
    return result === 0 ? 0 : result;
  }

  const sign = num < 0 ? -1 : 1;
  const result = sign * Math.round(Math.abs(num) * 100 + 1e-9);
  return result === 0 ? 0 : result;
};

/**
 * Convert integer cents back to rupees (number with at most 2 decimal places).
 */
export const fromCents = (cents) => {
  const c = assertSafeInt(cents, "cents");
  if (c === 0) return 0;
  return Number((c / 100).toFixed(2));
};

/**
 * Sum integer cent amounts without using floating-point arithmetic.
 */
export const addCents = (...values) => {
  let sum = 0;
  for (const val of values) {
    if (Array.isArray(val)) {
      for (const item of val) {
        sum += assertSafeInt(item, "cents");
      }
    } else if (val !== null && val !== undefined) {
      sum += assertSafeInt(val, "cents");
    }
  }
  return sum === 0 ? 0 : sum;
};

/**
 * Split `totalCents` proportionally by `weights[]`.
 * Uses integer division and assigns any rounding remainder to the largest share
 * so the returned parts always sum to `totalCents` exactly.
 */
export const splitByWeight = (totalCents, weights) => {
  const total = assertSafeInt(totalCents, "totalCents");
  if (!Array.isArray(weights)) {
    throw new TypeError("weights must be an array");
  }
  if (weights.length === 0) return [];

  const cleanWeights = weights.map((w) => {
    const n = Number(w);
    if (!Number.isFinite(n) || n < 0) {
      throw new TypeError(`weights must be finite non-negative numbers, got ${w}`);
    }
    return n;
  });

  const weightSum = cleanWeights.reduce((acc, w) => acc + w, 0);
  if (weightSum === 0) {
    const out = new Array(cleanWeights.length).fill(0);
    out[0] = total;
    return out;
  }

  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);

  // Convert weights to integer scale when possible, or use BigInt/integer scaling for precision
  // Multiply each weight by 1e6 to preserve up to 6 decimal places in weights cleanly
  const SCALE = 1_000_000;
  const intWeights = cleanWeights.map((w) => BigInt(Math.round(w * SCALE)));
  const intWeightSum = intWeights.reduce((acc, w) => acc + w, 0n);

  if (intWeightSum === 0n) {
    const out = new Array(cleanWeights.length).fill(0);
    out[0] = total;
    return out;
  }

  const bigTotal = BigInt(absTotal);
  const shares = intWeights.map((w) => Number((bigTotal * w) / intWeightSum));
  const allocated = shares.reduce((acc, s) => acc + s, 0);
  const remainder = absTotal - allocated;

  if (remainder > 0) {
    let largestIdx = 0;
    for (let i = 1; i < intWeights.length; i++) {
      if (intWeights[i] > intWeights[largestIdx]) {
        largestIdx = i;
      }
    }
    shares[largestIdx] += remainder;
  }

  return shares.map((s) => (s === 0 ? 0 : sign * s));
};
