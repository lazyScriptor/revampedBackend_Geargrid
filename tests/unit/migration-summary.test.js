import { describe, it, expect } from "vitest";
import { EXIT_CRASHED, EXIT_OK, EXIT_TENANT_FAILURES, exitCodeFor, formatFailureSummary } from "../../src/scripts/migrationSummary.js";

describe("migration runner summary", () => {
  it("exits 0 when every tenant migrated", () => {
    expect(exitCodeFor([])).toBe(EXIT_OK);
    expect(formatFailureSummary([])).toBe("");
  });

  it("exits with a distinct code when some tenants failed (so the deploy can still restart, but go red)", () => {
    expect(exitCodeFor([{ db_name: "geargrid_a", message: "x" }])).toBe(EXIT_TENANT_FAILURES);
    expect(new Set([EXIT_OK, EXIT_CRASHED, EXIT_TENANT_FAILURES]).size).toBe(3);
  });

  it("names every failed tenant and its error, and explains the consequence", () => {
    const out = formatFailureSummary([
      { db_name: "geargrid_acme_1", message: "Migration 20260520000001-add-track-overdue.js (up) failed: Duplicate column name 'track_overdue'" },
      { db_name: "geargrid_beta_2", message: "connect ECONNREFUSED" },
    ]);
    expect(out).toContain("2 tenant database(s) FAILED");
    expect(out).toContain("geargrid_acme_1: Migration 20260520000001-add-track-overdue.js");
    expect(out).toContain("Duplicate column name 'track_overdue'");
    expect(out).toContain("geargrid_beta_2: connect ECONNREFUSED");
    expect(out).toContain("Unknown column");
  });
});
