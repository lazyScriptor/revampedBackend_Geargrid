import { describe, it, expect } from "vitest";
import { wholeDaysBetween, lateDays, isOpenEndedLine, openEndedExtraDays } from "../../src/services/invoiceService.js";

const open = { track_overdue: false, borrow_date: "2026-10-20", expected_return_date: "2026-10-20", locked_minimum_days: 1 };

describe("rental day math", () => {
  it("counts whole calendar days", () => {
    expect(wholeDaysBetween("2026-10-20", "2026-10-22")).toBe(2);
    expect(wholeDaysBetween("2026-10-20", "2026-10-20")).toBe(0);
  });
  it("late days never go negative", () => {
    expect(lateDays("2026-10-22", "2026-10-20")).toBe(0);
    expect(lateDays("2026-10-22", "2026-10-25")).toBe(3);
  });
  it("recognises a line dispatched with no return date, but not a waived tracked one", () => {
    expect(isOpenEndedLine(open)).toBe(true);
    expect(isOpenEndedLine({ ...open, track_overdue: 0 })).toBe(true);
    expect(isOpenEndedLine({ ...open, track_overdue: true })).toBe(false);
    expect(isOpenEndedLine({ ...open, expected_return_date: "2026-10-23" })).toBe(false);
  });
  it("machine out 2 days is billed 2 days (1 extra beyond the day-1 price)", () => {
    expect(openEndedExtraDays(open, "2026-10-22")).toBe(1);
  });
  it("same-day and next-day returns add nothing", () => {
    expect(openEndedExtraDays(open, "2026-10-20")).toBe(0);
    expect(openEndedExtraDays(open, "2026-10-21")).toBe(0);
  });
  it("days already covered by the minimum-days package are free", () => {
    expect(openEndedExtraDays({ ...open, locked_minimum_days: 3 }, "2026-10-23")).toBe(0);
    expect(openEndedExtraDays({ ...open, locked_minimum_days: 3 }, "2026-10-25")).toBe(2);
  });
});
