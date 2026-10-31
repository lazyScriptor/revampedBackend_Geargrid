import { describe, it, expect } from "vitest";
import { resolveIssuedDate } from "../../src/services/invoiceService.js";

describe("resolveIssuedDate", () => {
  const now = new Date("2026-10-31T10:00:00Z");

  it("returns null when no date is given (bill uses now)", () => {
    expect(resolveIssuedDate(undefined, now)).toBeNull();
    expect(resolveIssuedDate(null, now)).toBeNull();
    expect(resolveIssuedDate("", now)).toBeNull();
  });

  it("accepts a past date and time", () => {
    expect(resolveIssuedDate("2026-10-28T08:15:00+05:30", now).toISOString()).toBe("2026-10-28T02:45:00.000Z");
  });

  it("allows a few minutes of clock drift", () => {
    expect(resolveIssuedDate("2026-10-31T10:03:00Z", now)).toBeInstanceOf(Date);
  });

  it("rejects future dates and garbage", () => {
    expect(() => resolveIssuedDate("2026-11-01T10:00:00Z", now)).toThrow(/future/);
    expect(() => resolveIssuedDate("not a date", now)).toThrow(/valid/);
  });
});
