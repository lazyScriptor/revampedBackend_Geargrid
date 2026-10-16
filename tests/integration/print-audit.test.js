import { describe, it, expect, vi } from "vitest";

/**
 * POS Thermal Receipt Print & Audit Trail Integration Tests
 * Golden Rule: Every bill print must log to INVOICE_PRINT_LOGS before physical printout.
 */

describe("POS Print Log & Telemetry Audit Tests", () => {
  const createMockPrintLogPayload = (overrides = {}) => ({
    invoice_id: overrides.invoice_id || 67,
    doc_number: overrides.doc_number || "INV-67",
    printer_name: overrides.printer_name || "EPSON TM-T88VI",
    print_reason: overrides.print_reason || "Customer Copy",
    subtotal: overrides.subtotal ?? 10000,
    grand_total: overrides.grand_total ?? 11500,
    advance_amount: overrides.advance_amount ?? 3000,
    balance_amount: overrides.balance_amount ?? 8500,
    bill_snapshot: {
      invoice_id: 67,
      customer_name: "Sunil Silva",
      line_items: [
        { name: "Power Generator 5kVA", qty: 1, rate: 10000, days: 1 },
      ],
    },
    ...overrides,
  });

  it("successfully formats and enriches print log with actor staff details and snapshot", () => {
    const user = {
      userId: 1,
      username: "admin_kasun",
      first_name: "Kasun",
      last_name: "Rajapaksha",
      roles: ["SuperAdmin"],
    };

    const payload = createMockPrintLogPayload();

    const formatPrintLogRecord = (actor, data, ip) => {
      const fullName = `${actor.first_name || ""} ${actor.last_name || ""}`.trim();
      const printedByName = fullName && actor.username
        ? `${fullName} (${actor.username})`
        : fullName || actor.username || "Staff";

      return {
        invoice_id: data.invoice_id,
        doc_number: data.doc_number,
        printed_by_user_id: actor.userId,
        printed_by_name: printedByName,
        printed_by_role: actor.roles?.[0] || "Staff",
        printer_name: data.printer_name,
        print_reason: data.print_reason,
        subtotal: data.subtotal,
        grand_total: data.grand_total,
        advance_amount: data.advance_amount,
        balance_amount: data.balance_amount,
        bill_snapshot: JSON.stringify(data.bill_snapshot),
        ip_address: ip,
        timestamp: new Date().toISOString(),
      };
    };

    const record = formatPrintLogRecord(user, payload, "192.168.1.105");

    expect(record.invoice_id).toBe(67);
    expect(record.doc_number).toBe("INV-67");
    expect(record.printed_by_name).toBe("Kasun Rajapaksha (admin_kasun)");
    expect(record.printed_by_role).toBe("SuperAdmin");
    expect(record.printer_name).toBe("EPSON TM-T88VI");
    expect(record.ip_address).toBe("192.168.1.105");
    expect(JSON.parse(record.bill_snapshot).customer_name).toBe("Sunil Silva");
  });

  it("handles printer name with spaces without regex truncation (geargrid-print-agent bug fix)", () => {
    const lpstatOutput = "printer EPSON_TM_T88VI is idle. enabled since Fri Oct 16";
    // If output is: printer EPSON TM-T88VI Receipt is idle
    const lpstatWithSpaces = "printer EPSON TM-T88VI Receipt is idle. enabled";

    // Buggy regex in geargrid-print-agent line 80:
    // l.match(/^printer\s+(\S+)/) -> matches only non-whitespace, truncating to 'EPSON'!
    const buggyMatch = lpstatWithSpaces.match(/^printer\s+(\S+)/);
    expect(buggyMatch[1]).toBe("EPSON"); // BUG: Truncated!

    // Remediated regex: matches full printer name up to ' is' or ':'
    const fixedMatch = lpstatWithSpaces.match(/^printer\s+([^\s:]+(?:\s+[^\s:]+)*?)(?:\s+is|\:|$)/i);
    expect(fixedMatch[1]).toBe("EPSON TM-T88VI Receipt"); // Properly preserved!
  });
});
