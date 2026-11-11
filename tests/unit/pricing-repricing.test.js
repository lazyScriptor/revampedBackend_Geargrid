import { describe, expect, it } from "vitest";
import { repriceLine } from "../../src/scripts/repricePeriodLines.js";

const issuedAt = "2026-11-09T10:00:00+05:30";
const scaffold = (overrides = {}) => ({
  borrow_date: "2026-11-09",
  expected_return_date: "2026-11-09",
  track_overdue: false,
  borrow_quantity: 2,
  locked_base_price: 50,
  locked_minimum_days: 1,
  locked_extra_daily_rate: 50,
  line_status: "Active",
  ...overrides,
});

describe("historical period-price correction (pure repricing calculation)", () => {
  it("recalculates the INV-104 snapshots from current equipment prices without compounding old totals", () => {
    const plank = repriceLine(
      scaffold({ locked_minimum_days: 5 }),
      { base: 250, minDays: 5, rate: 100 },
      [],
      issuedAt,
    );
    const scaffoldingSet = repriceLine(
      scaffold(),
      { base: 250, minDays: 5, rate: 50 },
      [],
      issuedAt,
    );

    expect(plank).toEqual({ lineTotal: 500, dispatch: 500, late: 0 });
    expect(scaffoldingSet).toEqual({ lineTotal: 500, dispatch: 500, late: 0 });
    expect(plank.lineTotal + scaffoldingSet.lineTotal).toBe(1000);

    // Re-running the pure calculation against the corrected locked values produces the same amount,
    // rather than adding the correction a second time to the previous line total.
    expect(
      repriceLine(
        scaffold({ locked_base_price: 250, locked_minimum_days: 5, locked_extra_daily_rate: 100 }),
        { base: 250, minDays: 5, rate: 100 },
        [],
        issuedAt,
      ).lineTotal,
    ).toBe(500);
  });

  it("replays all handovers in a partial open-ended return using each returned quantity", () => {
    const line = scaffold({ borrow_quantity: 3 });
    const prices = { base: 250, minDays: 5, rate: 50 };
    const result = repriceLine(
      line,
      prices,
      [
        { qty: 1, at: "2026-11-10T12:00:00+05:30", date: "2026-11-10" }, // day 2: no extra
        { qty: 1, at: "2026-11-14T12:00:00+05:30", date: "2026-11-14" }, // day 6: Rs. 50
        { qty: 1, at: "2026-11-17T12:00:00+05:30", date: "2026-11-17" }, // day 9: Rs. 200
      ],
      issuedAt,
    );

    expect(result).toEqual({ lineTotal: 1000, dispatch: 1000, late: 0 });
  });

  it("splits tracked base-period rental from late fees and honors a fee waiver", () => {
    const line = scaffold({
      expected_return_date: "2026-11-10",
      track_overdue: true,
      locked_minimum_days: 5,
    });
    const prices = { base: 250, minDays: 5, rate: 50 };
    const returnedLate = [{ qty: 2, date: "2026-11-15", at: "2026-11-15T10:00:00+05:30" }];

    expect(repriceLine(line, prices, returnedLate, issuedAt)).toEqual({
      lineTotal: 600,
      dispatch: 500,
      late: 100,
    });
    expect(
      repriceLine(line, prices, [{ ...returnedLate[0], waived: true }], issuedAt),
    ).toEqual({ lineTotal: 500, dispatch: 500, late: 0 });
  });

  it("keeps a longer dispatch contract in the dispatch price, then adds only later late days", () => {
    const line = scaffold({
      expected_return_date: "2026-11-16",
      track_overdue: true,
      locked_minimum_days: 5,
    });
    const result = repriceLine(
      line,
      { base: 250, minDays: 5, rate: 50 },
      [{ qty: 2, date: "2026-11-18", at: "2026-11-18T10:00:00+05:30" }],
      issuedAt,
    );
    expect(result).toEqual({ lineTotal: 900, dispatch: 700, late: 200 });
  });

  it("accepts MySQL decimal strings without changing the rounded charge", () => {
    const result = repriceLine(
      scaffold({ locked_minimum_days: "1" }),
      { base: "250.00", minDays: "5", rate: "50.00" },
      [{ qty: 2, at: "2026-11-15T10:00:00+05:30", date: "2026-11-15" }],
      issuedAt,
    );
    expect(result).toEqual({ lineTotal: 600, dispatch: 600, late: 0 });
  });
});
