import { describe, it, expect } from "vitest";
import { toCents, fromCents, addCents, splitByWeight } from "../../src/modules/retail/index.js";

describe("retail/money helpers", () => {
  describe("toCents & fromCents", () => {
    it("handles classic floating-point rounding traps", () => {
      expect(toCents(1.005)).toBe(101);
      expect(toCents("1.005")).toBe(101);
      expect(toCents(19.99)).toBe(1999);
      expect(toCents(0.1 + 0.2)).toBe(30);
      expect(toCents(-1.005)).toBe(-101);
      expect(toCents(0)).toBe(0);
      expect(toCents(-0)).toBe(0);
      expect(toCents(null)).toBe(0);
      expect(toCents(undefined)).toBe(0);
      expect(toCents("")).toBe(0);
    });

    it("converts integer cents back to rupees", () => {
      expect(fromCents(101)).toBe(1.01);
      expect(fromCents(1999)).toBe(19.99);
      expect(fromCents(-505)).toBe(-5.05);
      expect(fromCents(0)).toBe(0);
    });

    it("rejects non-finite or non-integer cents", () => {
      expect(() => toCents(Number.NaN)).toThrow();
      expect(() => toCents(Number.POSITIVE_INFINITY)).toThrow();
      expect(() => fromCents(12.5)).toThrow();
    });
  });

  describe("addCents", () => {
    it("adds integers and arrays without floating-point drift", () => {
      expect(addCents(10, 20, 30)).toBe(60);
      expect(addCents([1999, 2501], -500)).toBe(4000);
      expect(addCents(100, -100)).toBe(0);
    });
  });

  describe("splitByWeight", () => {
    it("assigns rounding remainder to the largest share and always sums to total", () => {
      // 100 cents split 1 : 2 : 3 -> 16.66, 33.33, 50.00 -> remainder 1 goes to index 2 (weight 3)
      const parts = splitByWeight(100, [1, 2, 3]);
      expect(parts).toEqual([16, 33, 51]);
      expect(addCents(parts)).toBe(100);
    });

    it("handles equal weights by giving remainder to the first largest share", () => {
      const parts = splitByWeight(100, [1, 1, 1]);
      expect(parts).toEqual([34, 33, 33]);
      expect(addCents(parts)).toBe(100);
    });

    it("handles negative totals (e.g. refund splits) symmetrically", () => {
      const parts = splitByWeight(-100, [1, 2, 3]);
      expect(parts).toEqual([-16, -33, -51]);
      expect(addCents(parts)).toBe(-100);
    });

    it("handles zero weights and empty arrays", () => {
      expect(splitByWeight(100, [])).toEqual([]);
      const zeroWeights = splitByWeight(100, [0, 0, 0]);
      expect(zeroWeights).toEqual([100, 0, 0]);
      expect(addCents(zeroWeights)).toBe(100);
    });

    it("always sums exactly across many prime totals and fractional weights", () => {
      const weights = [12.5, 37.25, 99.99, 0.01];
      for (const total of [1, 7, 97, 999, 1234567]) {
        const split = splitByWeight(total, weights);
        expect(addCents(split)).toBe(total);
        expect(split.every(Number.isInteger)).toBe(true);
      }
    });
  });
});
