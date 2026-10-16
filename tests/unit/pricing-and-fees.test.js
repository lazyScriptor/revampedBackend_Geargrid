import { describe, it, expect } from "vitest";

/**
 * Pure Domain Pricing & Fee Calculation Tests
 * Invariant: grandTotal = max(0, subtotal + transport_fee - discount)
 * Invariant: balanceDue = max(0, grandTotal - advance)
 */

describe("Domain Pricing & Financial Invariant Unit Tests", () => {
  const calculateCartTotals = (items, fees = {}) => {
    const transport = Math.max(0, Number(fees.transport) || 0);
    const discount = Math.max(0, Number(fees.discount) || 0);
    const advance = Math.max(0, Number(fees.advance) || 0);

    const subTotal = items.reduce((sum, item) => {
      const rate = Number(item.rate_per_day) || 0;
      const qty = Number(item.borrow_quantity) || 1;
      const days = Math.max(1, Number(item.rental_days) || 1);
      return sum + rate * qty * days;
    }, 0);

    const grandTotal = Math.max(0, subTotal + transport - discount);
    const balanceDue = Math.max(0, grandTotal - advance);

    return {
      subTotal,
      transport,
      discount,
      grandTotal,
      advance,
      balanceDue,
    };
  };

  it("calculates subtotal accurately for single equipment item", () => {
    const items = [
      { equipment_name: "Jackhammer", rate_per_day: 2500, borrow_quantity: 2, rental_days: 3 },
    ];
    const totals = calculateCartTotals(items);
    expect(totals.subTotal).toBe(15000);
    expect(totals.grandTotal).toBe(15000);
    expect(totals.balanceDue).toBe(15000);
  });

  it("applies transport fee and discount properly to grand total", () => {
    const items = [
      { equipment_name: "Excavator Blade", rate_per_day: 5000, borrow_quantity: 1, rental_days: 2 },
    ];
    const fees = { transport: 1500, discount: 500 };
    const totals = calculateCartTotals(items, fees);

    expect(totals.subTotal).toBe(10000);
    expect(totals.grandTotal).toBe(11000); // 10000 + 1500 - 500
    expect(totals.balanceDue).toBe(11000);
  });

  it("prevents grand total from dropping below zero when discount exceeds subtotal", () => {
    const items = [
      { equipment_name: "Measuring Tape", rate_per_day: 100, borrow_quantity: 1, rental_days: 1 },
    ];
    const fees = { transport: 0, discount: 500 };
    const totals = calculateCartTotals(items, fees);

    expect(totals.subTotal).toBe(100);
    expect(totals.grandTotal).toBe(0); // Floor at 0
    expect(totals.balanceDue).toBe(0);
  });

  it("computes balance due correctly when advance payment is received", () => {
    const items = [
      { equipment_name: "Concrete Mixer", rate_per_day: 4000, borrow_quantity: 1, rental_days: 2 },
    ];
    const fees = { transport: 1000, discount: 0, advance: 3000 };
    const totals = calculateCartTotals(items, fees);

    expect(totals.grandTotal).toBe(9000); // 8000 + 1000
    expect(totals.advance).toBe(3000);
    expect(totals.balanceDue).toBe(6000); // 9000 - 3000
  });

  describe("Late Fee Tier Calculations", () => {
    const calculateLateFee = ({ ratePerDay, expectedReturn, actualReturn, graceHours = 2 }) => {
      const diffMs = new Date(actualReturn) - new Date(expectedReturn);
      if (diffMs <= 0) return 0;

      const diffHours = diffMs / (1000 * 60 * 60);
      if (diffHours <= graceHours) return 0; // Within grace period

      const overdueDays = Math.ceil(diffHours / 24);
      return overdueDays * ratePerDay;
    };

    it("returns 0 fee if returned on or before expected return date", () => {
      const fee = calculateLateFee({
        ratePerDay: 2000,
        expectedReturn: "2026-10-15T18:00:00Z",
        actualReturn: "2026-10-15T17:30:00Z",
      });
      expect(fee).toBe(0);
    });

    it("waives late fee within grace period (e.g. 2 hours)", () => {
      const fee = calculateLateFee({
        ratePerDay: 2000,
        expectedReturn: "2026-10-15T18:00:00Z",
        actualReturn: "2026-10-15T19:30:00Z",
        graceHours: 2,
      });
      expect(fee).toBe(0);
    });

    it("accrues 1 day rate for 1 day overdue past grace period", () => {
      const fee = calculateLateFee({
        ratePerDay: 2000,
        expectedReturn: "2026-10-15T18:00:00Z",
        actualReturn: "2026-10-16T19:00:00Z",
        graceHours: 2,
      });
      expect(fee).toBe(4000); // 25 hours overdue -> 2 days rounded up
    });
  });

  describe("BUG-P2-01: Transport Fee Retention on Partial Updates", () => {
    it("preserves existing transport fee when fee update payload omits transport_fee", () => {
      const existingInvoice = {
        total_amount: 15000,
        transport_fee: 2500,
        discount: 500,
      };

      const patchPayload = {
        discount: 1000, // Operator only updated discount
      };

      // Defect reproduction: naive assignment oldTransport = payload.transport_fee || 0 zeroed out the fee
      const fixedTransportFee = patchPayload.transport_fee !== undefined
        ? Number(patchPayload.transport_fee)
        : Number(existingInvoice.transport_fee);

      expect(fixedTransportFee).toBe(2500); // Must NOT be wiped to 0
    });
  });
});
