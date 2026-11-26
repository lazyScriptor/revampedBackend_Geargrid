// Production 2026-11-15: every restart was ~2.5 min of 502s while server.js ran sequelize.sync() on every
// tenant before listening; the sync stopped part-way on legacy zero dates, so BULK_JOBS never got created
// on two shops, and the bulk job worker's error for the first such tenant ended the whole tick.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Sequelize } from "sequelize";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("server startup", () => {
  const src = readFileSync(join(root, "src/server.js"), "utf8").replace(/\/\/.*$/gm, "");

  it("never calls sequelize.sync() (schema comes from migrations at deploy time)", () => {
    expect(src).not.toMatch(/\.sync\s*\(/);
  });

  it("still fills the tenant connection cache before listening (signed-in users and the worker need it)", () => {
    expect(src.indexOf("getTenantConnection(")).toBeGreaterThan(-1);
    expect(src.indexOf("getTenantConnection(")).toBeLessThan(src.indexOf(".listen("));
  });
});

describe("bulk job worker tick", () => {
  const claim = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    claim.mockReset();
    vi.doMock("../../src/config/database.js", () => ({
      masterSequelize: { query: vi.fn(async () => [{ db_name: "geargrid_broken" }, { db_name: "geargrid_ok" }]) },
      getCachedTenantConnection: (db) => ({ db }),
    }));
    vi.doMock("../../src/models/index.js", () => ({ initTenantModels: (conn) => ({ conn }) }));
    vi.doMock("../../src/services/bulkJobService.js", () => ({
      claimNextQueuedJobs: claim,
      updateProgress: vi.fn(),
      completeJob: vi.fn(),
      failJob: vi.fn(),
      markAwaitingConfirmation: vi.fn(),
    }));
    vi.doMock("../../src/services/notificationService.js", () => ({ createNotification: vi.fn() }));
    vi.doMock("../../src/workers/handlers/index.js", () => ({ handlers: {} }));
  });
  afterEach(() => {
    for (const m of ["config/database.js", "models/index.js", "services/bulkJobService.js", "services/notificationService.js", "workers/handlers/index.js"]) {
      vi.doUnmock(`../../src/${m}`);
    }
    vi.resetModules();
  });

  it("a tenant whose BULK_JOBS table is missing does not stop the tenants after it", async () => {
    claim.mockImplementation(async (models) => {
      if (models.conn.db === "geargrid_broken") throw new Error("Table 'geargrid_broken.BULK_JOBS' doesn't exist");
      return [];
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { tickOnce } = await import("../../src/workers/bulkJobWorker.js");
    await expect(tickOnce()).resolves.toBeUndefined();
    expect(claim.mock.calls.map(([m]) => m.conn.db)).toEqual(["geargrid_broken", "geargrid_ok"]);
    expect(errors.mock.calls[0][0]).toContain("geargrid_broken");
    errors.mockRestore();
  });
});

describe("db:schema:check", () => {
  it("reports missing tables and columns, and is exact about table-name case", async () => {
    const { findSchemaGaps } = await import("../../src/scripts/schemaCheck.js");
    const expected = { BULK_JOBS: ["job_id", "status"], USERS: ["user_id", "phone_number"] };
    const actual = { bulk_jobs: new Set(["job_id", "status"]), USERS: new Set(["user_id"]) };
    expect(findSchemaGaps(expected, actual)).toEqual([
      { table: "BULK_JOBS", column: null },
      { table: "USERS", column: "phone_number" },
    ]);
    expect(findSchemaGaps({ USERS: ["user_id"] }, { USERS: new Set(["user_id"]) })).toEqual([]);
  });

  it("derives the expected schema from the real tenant models", async () => {
    const { expectedSchema } = await import("../../src/scripts/schemaCheck.js");
    const { initTenantModels } = await import("../../src/models/index.js");
    const seq = new Sequelize("x", "x", "x", { dialect: "mysql", logging: false });
    const schema = expectedSchema(initTenantModels(seq));
    expect(schema.BULK_JOBS).toEqual(expect.arrayContaining(["job_id", "status", "createdAt", "updatedAt"]));
    expect(Object.keys(schema).length).toBeGreaterThan(20);
  });
});
