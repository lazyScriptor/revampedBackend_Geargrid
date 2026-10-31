import { describe, it, expect } from "vitest";
import { wholeDaysBetween, lateDays, isOpenEndedLine, openEndedExtraDays, elapsedRentalDays, lineOutMoment } from "../../src/services/invoiceService.js";

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
  it("anything past 24 hours is the next day (29 hours = 2 days)", () => {
    expect(elapsedRentalDays("2026-10-30T09:42:00+05:30", "2026-10-31T15:08:00+05:30")).toBe(2);
    expect(elapsedRentalDays("2026-10-30T09:42:00+05:30", "2026-10-31T09:42:00+05:30")).toBe(1);
    expect(elapsedRentalDays("2026-10-30T09:42:00+05:30", "2026-10-31T09:43:00+05:30")).toBe(2);
    expect(elapsedRentalDays("2026-10-30T09:42:00+05:30", "2026-10-30T10:00:00+05:30")).toBe(1);
    expect(elapsedRentalDays("2026-10-30T09:42:00+05:30", "2026-11-01T09:43:00+05:30")).toBe(3);
  });
  it("out 29 hours is billed 2 days: 1 extra beyond the day-1 price", () => {
    const out = lineOutMoment(open, "2026-10-20T04:12:00.000Z"); // 9:42 AM in Colombo
    expect(openEndedExtraDays(open, out, "2026-10-21T09:38:00.000Z")).toBe(1);
    expect(openEndedExtraDays(open, out, "2026-10-21T04:12:00.000Z")).toBe(0);
  });
  it("the out moment follows the line's out date at the bill's time of day", () => {
    const out = lineOutMoment({ ...open, borrow_date: "2026-10-18" }, "2026-10-20T04:12:00.000Z");
    expect(out.toISOString()).toBe("2026-10-18T04:12:00.000Z");
  });
  it("days already covered by the minimum-days package are free", () => {
    const out = lineOutMoment({ ...open, locked_minimum_days: 3 }, "2026-10-20T04:12:00.000Z");
    expect(openEndedExtraDays({ ...open, locked_minimum_days: 3 }, out, "2026-10-23T04:00:00.000Z")).toBe(0);
    expect(openEndedExtraDays({ ...open, locked_minimum_days: 3 }, out, "2026-10-25T04:00:00.000Z")).toBe(2);
  });
});
