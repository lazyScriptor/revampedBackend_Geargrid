import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import fc from "fast-check";

import {
  periodCharge,
  chargeableLateDays,
  contractDays,
  openEndedExtraDays,
  elapsedRentalDays,
  lateDays,
  wholeDaysBetween,
  isOpenEndedLine,
  lineOutMoment,
} from "../../src/utils/rentalDays.js";
import { lineAccrual } from "../../src/services/accrualService.js";
import { createDispatchInvoice, processReturn } from "../../src/services/invoiceService.js";

vi.mock("../../src/sockets/emitters.js", () => ({ emitToUser: vi.fn(), emitToTenant: vi.fn() }));

const at = (s) => new Date(`${s}+05:30`);
const withUpdate = (o) => Object.assign(o, { update: vi.fn(async (p) => Object.assign(o, p)) });

const goldenPath = path.resolve(__dirname, "../fixtures/pricing-golden.json");
const sha256Path = path.resolve(__dirname, "../fixtures/pricing-golden.sha256");
const goldenCases = JSON.parse(fs.readFileSync(goldenPath, "utf-8"));

describe("Step 4: Golden file integrity", () => {
  it("pricing-golden.json matches pricing-golden.sha256 exactly", () => {
    const content = fs.readFileSync(goldenPath, "utf-8");
    const expectedSha = fs.readFileSync(sha256Path, "utf-8").trim();
    const actualSha = crypto.createHash("sha256").update(content, "utf-8").digest("hex");
    expect(actualSha).toBe(expectedSha);
  });
});

describe("Step 2.1: Golden table unit assertions", () => {
  for (const tc of goldenCases) {
    if (tc.line) {
      it(`Golden Case [${tc.id}]: ${tc.description}`, async () => {
        const l = { ...tc.line };
        const issued = new Date(tc.issuedAt);
        const atMoment = new Date(tc.at);
        const retDate = tc.returnDate;

        // 1. periodCharge / dispatchTotal
        const cDays = Math.max(1, wholeDaysBetween(l.borrow_date, l.expected_return_date));
        const disp = periodCharge({
          base: l.locked_base_price,
          minDays: l.locked_minimum_days,
          rate: l.locked_extra_daily_rate,
          days: cDays,
          qty: l.borrow_quantity,
        });
        expect(disp).toBeCloseTo(tc.expected.dispatchTotal, 2);

        // 2. chargeableLateDays or openEndedExtraDays
        if (isOpenEndedLine(l)) {
          const outAt = lineOutMoment(l, issued);
          const extra = openEndedExtraDays(l, outAt, atMoment);
          expect(extra).toBe(tc.expected.extraOrLateDays);
        } else if (l.track_overdue) {
          if (!tc.waiveLateFee) {
            const chLate = chargeableLateDays(l, retDate);
            expect(chLate).toBe(tc.expected.extraOrLateDays);
          }
        }

        // 3. lineAccrual
        if (l.line_status === "Active") {
          const acc = lineAccrual(l, issued, atMoment);
          expect(acc.accrued_charge).toBeCloseTo(tc.expected.accruedChargeIfStillOut, 2);
        }

        // 4. processReturn with mocked models
        const lineModel = withUpdate({
          line_id: 1,
          equipment_id: 1,
          ...l,
          line_total_amount: l.line_total_amount ?? disp,
        });

        const initialInvSubTotal = l.line_total_amount ?? disp;
        const initialInvTotal = l.line_total_amount ?? disp;

        const invModel = withUpdate({
          invoice_id: 101,
          status: "Active",
          issued_date: issued,
          sub_total: initialInvSubTotal,
          total_amount: initialInvTotal,
          accrued_charges: 0,
          accrued_rental: 0,
          id_card_status: 1,
        });

        const equipModel = withUpdate({
          equipment_id: 1,
          rented_qty: l.borrow_quantity,
          available_qty: 0,
          defective_qty: 0,
        });

        const models = {
          sequelize: { transaction: async (fn) => fn({ LOCK: { UPDATE: "UPDATE" } }) },
          Invoice: {
            findByPk: async () => invModel,
            findAll: async () => [Object.assign(invModel, { InvoiceLines: [lineModel] })],
          },
          InvoiceLine: {
            findByPk: async () => lineModel,
            count: async ({ where }) => (where.line_status === "Active" && lineModel.line_status === "Active" ? 1 : 0),
          },
          Equipment: { findByPk: async () => equipModel },
          DefectLog: { create: vi.fn() },
          Payment: { create: vi.fn(), sum: async () => 0 },
          Customer: { update: vi.fn() },
          InvoiceTrace: { create: vi.fn() },
        };

        const retQty = tc.returnQty ?? l.borrow_quantity;
        const gQty = tc.goodQty ?? retQty;
        const dQty = tc.defectiveQty ?? 0;

        await processReturn(
          models,
          {
            invoice_id: 101,
            final_payment_amount: 0,
            lines_returned: [
              {
                line_id: 1,
                good_qty: gQty,
                defective_qty: dQty,
                actual_return_date: retDate,
                actual_return_at: atMoment.toISOString(),
                ...(tc.waiveLateFee ? { track_overdue: false } : {}),
              },
            ],
          },
          1,
        );

        expect(lineModel.line_total_amount).toBeCloseTo(tc.expected.chargeAtReturn, 2);
        expect(invModel.total_amount - initialInvTotal).toBeCloseTo(tc.expected.totalDelta, 2);
        expect(invModel.sub_total - initialInvSubTotal).toBeCloseTo(tc.expected.subTotalDelta, 2);
      });
    }
  }
});

describe("Step 2.2: Dispatch Invoice calculations", () => {
  it("creates dispatch invoice with correct subtotal and grand total", async () => {
    const multiCase = goldenCases.find((c) => c.id === "E18-multi-line-invoice");
    expect(multiCase).toBeDefined();

    const createdInvoices = [];
    const createdLines = [];

    const models = {
      sequelize: {
        transaction: async (fn) => fn({ LOCK: { UPDATE: "UPDATE" } }),
      },
      Invoice: {
        create: vi.fn(async (data) => {
          const inv = withUpdate({ invoice_id: 200, ...data });
          createdInvoices.push(inv);
          return inv;
        }),
        findAll: vi.fn(async () => createdInvoices),
      },
      InvoiceLine: {
        bulkCreate: vi.fn(async (lines) => {
          createdLines.push(...lines);
          return lines;
        }),
      },
      Equipment: {
        findByPk: vi.fn(async (id) =>
          withUpdate({
            equipment_id: id,
            available_qty: 10,
            rented_qty: 0,
            equipment_name: `Equip ${id}`,
          }),
        ),
      },
      InvoiceTrace: { create: vi.fn() },
      Customer: {
        findByPk: vi.fn(async () => ({ customer_id: 1, customer_delete_status: false, status: "Active" })),
      },
    };

    const payload = {
      customer_id: 1,
      items: multiCase.lines.map((l, idx) => ({ ...l, equipment_id: idx + 1 })),
      fees: {
        transport: multiCase.invoice.transport_fee,
        discount: multiCase.invoice.discount_amount,
      },
      issued_date: multiCase.issuedAt,
    };

    const res = await createDispatchInvoice(models, payload, 1);
    expect(res.sub_total).toBeCloseTo(multiCase.invoice.expectedDispatchSubTotal, 2);
    expect(res.total_amount).toBeCloseTo(multiCase.invoice.expectedDispatchTotal, 2);
  });

  it("caps total_amount at zero when discount exceeds subtotal + fees", async () => {
    const discountCase = goldenCases.find((c) => c.id === "E18-discount-caps-at-zero");
    expect(discountCase).toBeDefined();

    const models = {
      sequelize: { transaction: async (fn) => fn({ LOCK: { UPDATE: "UPDATE" } }) },
      Invoice: {
        create: vi.fn(async (data) => {
          const inv = withUpdate({ invoice_id: 201, ...data });
          return inv;
        }),
        findAll: vi.fn(async () => []),
      },
      InvoiceLine: { bulkCreate: vi.fn(async (lines) => lines) },
      Equipment: {
        findByPk: vi.fn(async (id) => withUpdate({ equipment_id: id, available_qty: 10, rented_qty: 0 })),
      },
      InvoiceTrace: { create: vi.fn() },
      Customer: { findByPk: vi.fn(async () => ({ customer_id: 1, customer_delete_status: false, status: "Active" })) },
    };

    const payload = {
      customer_id: 1,
      items: discountCase.lines.map((l, idx) => ({ ...l, equipment_id: idx + 1 })),
      fees: {
        transport: discountCase.invoice.transport_fee,
        discount: discountCase.invoice.discount_amount,
      },
      issued_date: discountCase.issuedAt,
    };

    const res = await createDispatchInvoice(models, payload, 1);
    expect(res.total_amount).toBe(0);
    expect(res.sub_total).toBe(discountCase.invoice.expectedDispatchSubTotal);
  });
});

describe("Step 2.3: Return accounting invariants", () => {
  it("rejects returns where totalReturnedNow > remainingToReturn with status 400", async () => {
    const lineModel = withUpdate({
      line_id: 1,
      equipment_id: 1,
      line_status: "Active",
      borrow_quantity: 2,
      good_returned_qty: 1,
      defective_returned_qty: 0,
      borrow_date: "2026-11-09",
      expected_return_date: "2026-11-09",
      track_overdue: false,
      locked_base_price: 250,
      locked_minimum_days: 5,
      locked_extra_daily_rate: 50,
      line_total_amount: 500,
    });
    const invModel = withUpdate({ invoice_id: 301, status: "Active", total_amount: 500, sub_total: 500 });

    const models = {
      sequelize: { transaction: async (fn) => fn({ LOCK: { UPDATE: "UPDATE" } }) },
      Invoice: { findByPk: async () => invModel, findAll: async () => [invModel] },
      InvoiceLine: { findByPk: async () => lineModel, count: async () => 1 },
      Equipment: { findByPk: async () => withUpdate({ equipment_id: 1, rented_qty: 1, available_qty: 1 }) },
      DefectLog: { create: vi.fn() },
      Payment: { create: vi.fn(), sum: async () => 0 },
      Customer: { update: vi.fn() },
      InvoiceTrace: { create: vi.fn() },
    };

    await expect(
      processReturn(
        models,
        {
          invoice_id: 301,
          final_payment_amount: 0,
          lines_returned: [{ line_id: 1, good_qty: 2, defective_qty: 0, actual_return_date: "2026-11-10" }],
        },
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("updates stock correctly: rented decreases, available increases by good, defective by defect qty", async () => {
    const lineModel = withUpdate({
      line_id: 1,
      equipment_id: 1,
      line_status: "Active",
      borrow_quantity: 4,
      good_returned_qty: 0,
      defective_returned_qty: 0,
      borrow_date: "2026-11-09",
      expected_return_date: "2026-11-10",
      track_overdue: true,
      locked_base_price: 100,
      locked_minimum_days: 1,
      locked_extra_daily_rate: 100,
      line_total_amount: 400,
    });
    const invModel = withUpdate({ invoice_id: 302, status: "Active", total_amount: 400, sub_total: 400 });
    const equipModel = withUpdate({
      equipment_id: 1,
      rented_qty: 4,
      available_qty: 10,
      defective_qty: 2,
    });

    const defectMock = vi.fn();
    const models = {
      sequelize: { transaction: async (fn) => fn({ LOCK: { UPDATE: "UPDATE" } }) },
      Invoice: { findByPk: async () => invModel, findAll: async () => [invModel] },
      InvoiceLine: { findByPk: async () => lineModel, count: async () => 1 },
      Equipment: { findByPk: async () => equipModel },
      DefectLog: { create: defectMock },
      Payment: { create: vi.fn(), sum: async () => 0 },
      Customer: { update: vi.fn() },
      InvoiceTrace: { create: vi.fn() },
    };

    await processReturn(
      models,
      {
        invoice_id: 302,
        final_payment_amount: 0,
        lines_returned: [{ line_id: 1, good_qty: 2, defective_qty: 1, actual_return_date: "2026-11-10" }],
      },
      1,
    );

    expect(equipModel.rented_qty).toBe(4 - 3); // 1
    expect(equipModel.available_qty).toBe(10 + 2); // 12
    expect(equipModel.defective_qty).toBe(2 + 1); // 3
    expect(defectMock).toHaveBeenCalledTimes(1);
    expect(defectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        equipment_id: 1,
        reported_on_invoice_id: 302,
        defective_quantity: 1,
      }),
      expect.anything(),
    );
  });

  it("preserves line_total_amount monotonically (never goes down)", async () => {
    const lineModel = withUpdate({
      line_id: 1,
      equipment_id: 1,
      line_status: "Active",
      borrow_quantity: 2,
      good_returned_qty: 0,
      defective_returned_qty: 0,
      borrow_date: "2026-11-09",
      expected_return_date: "2026-11-16", // due 7 days
      track_overdue: true,
      locked_base_price: 250,
      locked_minimum_days: 5,
      locked_extra_daily_rate: 50,
      line_total_amount: 700,
    });
    const invModel = withUpdate({ invoice_id: 303, status: "Active", total_amount: 700, sub_total: 700 });
    const models = {
      sequelize: { transaction: async (fn) => fn({ LOCK: { UPDATE: "UPDATE" } }) },
      Invoice: { findByPk: async () => invModel, findAll: async () => [invModel] },
      InvoiceLine: { findByPk: async () => lineModel, count: async () => 0 },
      Equipment: { findByPk: async () => withUpdate({ equipment_id: 1, rented_qty: 2, available_qty: 0 }) },
      DefectLog: { create: vi.fn() },
      Payment: { create: vi.fn(), sum: async () => 0 },
      Customer: { update: vi.fn() },
      InvoiceTrace: { create: vi.fn() },
    };

    // Returned early on day 2
    await processReturn(
      models,
      {
        invoice_id: 303,
        final_payment_amount: 0,
        lines_returned: [{ line_id: 1, good_qty: 2, defective_qty: 0, actual_return_date: "2026-11-11" }],
      },
      1,
    );

    expect(lineModel.line_total_amount).toBeGreaterThanOrEqual(700);
    expect(invModel.total_amount).toBe(700);
  });
});

describe("Step 2.4: Property tests (fast-check)", () => {
  it("periodCharge never decreases as days grow, and is linear in quantity (500 runs)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }), // base
        fc.integer({ min: 1, max: 30 }),    // minDays
        fc.integer({ min: 0, max: 5000 }),  // rate
        fc.integer({ min: 1, max: 100 }),   // days1
        fc.integer({ min: 1, max: 100 }),   // days2
        fc.integer({ min: 1, max: 20 }),    // qty
        (base, minDays, rate, d1, d2, qty) => {
          const daysEarlier = Math.min(d1, d2);
          const daysLater = Math.max(d1, d2);

          const chargeEarlier = periodCharge({ base, minDays, rate, days: daysEarlier, qty });
          const chargeLater = periodCharge({ base, minDays, rate, days: daysLater, qty });
          expect(chargeLater).toBeGreaterThanOrEqual(chargeEarlier);

          const chargeUnit = periodCharge({ base, minDays, rate, days: daysEarlier, qty: 1 });
          expect(chargeEarlier).toBeCloseTo(chargeUnit * qty, 2);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("for every D <= minDays, periodCharge equals base * quantity (500 runs)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }), // base
        fc.integer({ min: 1, max: 30 }),    // minDays
        fc.integer({ min: 0, max: 5000 }),  // rate
        fc.integer({ min: 1, max: 20 }),    // qty
        (base, minDays, rate, qty) => {
          // choose a D between 1 and minDays
          for (let d = 1; d <= minDays; d++) {
            const charge = periodCharge({ base, minDays, rate, days: d, qty });
            expect(charge).toBe(base * qty);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it("chargeableLateDays is never above lateDays, and equals lateDays when minDays <= contractDays (500 runs)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),   // minDays
        fc.integer({ min: 1, max: 30 }),   // contractDays
        fc.integer({ min: 0, max: 40 }),   // daysAfterDue
        (minDays, cDays, daysAfterDue) => {
          const borrowYmd = "2026-11-01";
          const dueYmd = `2026-11-${String(1 + cDays).padStart(2, "0")}`;
          const actualYmd = `2026-11-${String(1 + cDays + daysAfterDue).padStart(2, "0")}`;

          const line = {
            borrow_date: borrowYmd,
            expected_return_date: dueYmd,
            locked_minimum_days: minDays,
          };

          const rawLate = lateDays(dueYmd, actualYmd);
          const chLate = chargeableLateDays(line, actualYmd);

          expect(chLate).toBeLessThanOrEqual(rawLate);
          if (minDays <= cDays) {
            expect(chLate).toBe(rawLate);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it("open-ended total after returning on day D equals periodCharge for D days (500 runs)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 1000 }), // base
        fc.integer({ min: 1, max: 10 }),    // minDays
        fc.integer({ min: 5, max: 500 }),   // rate
        fc.integer({ min: 1, max: 30 }),    // D (days out)
        fc.integer({ min: 1, max: 10 }),    // qty
        (base, minDays, rate, D, qty) => {
          const line = {
            borrow_date: "2026-11-01",
            expected_return_date: "2026-11-01",
            track_overdue: false,
            locked_base_price: base,
            locked_minimum_days: minDays,
            locked_extra_daily_rate: rate,
            borrow_quantity: qty,
          };
          const issuedAt = at("2026-11-01T10:00:00");
          // Return at D full days later: (D - 1) * 24h + 2h
          const returnAt = new Date(issuedAt.getTime() + (D - 1) * 24 * 3600 * 1000 + 2 * 3600 * 1000);

          const extraDays = openEndedExtraDays(line, issuedAt, returnAt);
          const totalAfterReturn = base * qty + extraDays * rate * qty;
          const expectedPeriod = periodCharge({ base, minDays, rate, days: D, qty });

          expect(totalAfterReturn).toBe(expectedPeriod);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("lineAccrual while still out on day D, plus dispatch total, equals total after returning on day D (500 runs)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 1000 }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 5, max: 500 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 10 }),
        (base, minDays, rate, D, qty) => {
          const line = {
            borrow_date: "2026-11-01",
            expected_return_date: "2026-11-01",
            track_overdue: false,
            locked_base_price: base,
            locked_minimum_days: minDays,
            locked_extra_daily_rate: rate,
            borrow_quantity: qty,
            good_returned_qty: 0,
            defective_returned_qty: 0,
            line_status: "Active",
          };
          const issuedAt = at("2026-11-01T10:00:00");
          const nowMoment = new Date(issuedAt.getTime() + (D - 1) * 24 * 3600 * 1000 + 2 * 3600 * 1000);

          const dispatch = base * qty;
          const acc = lineAccrual(line, issuedAt, nowMoment);
          const totalRunning = dispatch + acc.accrued_charge;

          const expectedPeriod = periodCharge({ base, minDays, rate, days: D, qty });
          expect(totalRunning).toBeCloseTo(expectedPeriod, 2);
        },
      ),
      { numRuns: 500 },
    );
  });
});
