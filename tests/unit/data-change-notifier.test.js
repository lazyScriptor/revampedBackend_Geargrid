import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

vi.mock("../../src/sockets/emitters.js", () => ({ emitToTenant: vi.fn() }));
import { emitToTenant } from "../../src/sockets/emitters.js";
import { dataChangeNotifier, topicsForPath } from "../../src/middlewares/dataChangeNotifier.js";

const run = (method, url, status, user = { tenantDbName: "geargrid_x", userId: 3 }) => {
  const res = new EventEmitter();
  res.statusCode = status;
  const next = vi.fn();
  dataChangeNotifier({ method, originalUrl: url, user }, res, next);
  res.emit("finish");
  return next;
};

describe("data:changed notices", () => {
  beforeEach(() => vi.mocked(emitToTenant).mockReset());

  it("maps paths to the data they change", () => {
    expect(topicsForPath("/api/invoices/45/return")).toEqual({ topics: ["invoices", "equipment", "customers", "dashboard"], invoice_id: 45 });
    expect(topicsForPath("/api/customers/12")).toEqual({ topics: ["customers"], customer_id: 12 });
    expect(topicsForPath("/api/customers/12/settlement")?.topics).toContain("equipment");
    expect(topicsForPath("/api/equipment/9")?.topics).toEqual(["equipment", "dashboard"]);
    expect(topicsForPath("/api/invoices/print-logs")).toBeNull();
    expect(topicsForPath("/api/me/ui-preferences")).toBeNull();
  });

  it("tells the shop's room after a successful save", () => {
    const next = run("POST", "/api/invoices/45/payments", 201);
    expect(next).toHaveBeenCalled();
    expect(emitToTenant).toHaveBeenCalledWith(
      "geargrid_x",
      "data:changed",
      expect.objectContaining({ topics: expect.arrayContaining(["invoices", "dashboard"]), invoice_id: 45, by: 3 }),
    );
  });

  it("stays quiet for reads, failures and requests without a shop", () => {
    run("GET", "/api/invoices", 200);
    run("POST", "/api/invoices", 400);
    run("POST", "/api/invoices", 201, null);
    expect(emitToTenant).not.toHaveBeenCalled();
  });
});
