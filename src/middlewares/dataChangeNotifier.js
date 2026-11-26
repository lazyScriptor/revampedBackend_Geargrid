// Tells every open screen of a shop which data just changed, so the web app can keep long
// caches (equipment list, customers, dashboard) and refresh only when something really moved.
//
// One place instead of an emit in every service: after any successful save (POST/PUT/PATCH/DELETE
// answering 2xx) the request path decides the topics, and the shop's socket room gets
//   data:changed { topics: [...], invoice_id?, customer_id?, by, at }
// It never blocks or fails the request.
import { emitToTenant } from "../sockets/emitters.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// First match wins. Paths are without the /api prefix.
const RULES = [
  // Bills move money and machines: returns put stock back, payments change balances.
  { test: /^\/invoices\/print-logs/, topics: [] },
  { test: /^\/invoices/, topics: ["invoices", "equipment", "customers", "dashboard"] },
  { test: /^\/customers\/\d+\/settlement/, topics: ["invoices", "equipment", "customers", "dashboard"] },
  { test: /^\/settlements/, topics: ["invoices", "equipment", "customers", "dashboard"] },
  { test: /^\/customers/, topics: ["customers"] },
  { test: /^\/(equipment|categories|defects|warehouses)/, topics: ["equipment", "dashboard"] },
  { test: /^\/retail/, topics: ["retail", "equipment", "dashboard"] },
  { test: /^\/(expenses|accounting)/, topics: ["dashboard"] },
  { test: /^\/bulk-jobs\/\d+\/confirm/, topics: ["equipment", "customers", "dashboard"] },
];

export const topicsForPath = (path) => {
  const p = String(path || "").replace(/^\/api/, "").split("?")[0];
  const rule = RULES.find((r) => r.test.test(p));
  if (!rule || rule.topics.length === 0) return null;
  const invoice = /^\/invoices\/(\d+)/.exec(p);
  const customer = /^\/customers\/(\d+)/.exec(p);
  return {
    topics: rule.topics,
    ...(invoice ? { invoice_id: Number(invoice[1]) } : {}),
    ...(customer ? { customer_id: Number(customer[1]) } : {}),
  };
};

export const dataChangeNotifier = (req, res, next) => {
  if (!MUTATING.has(req.method)) return next();
  res.on("finish", () => {
    try {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const tenantDbName = req.user?.tenantDbName;
      if (!tenantDbName) return;
      const change = topicsForPath(req.originalUrl || req.url);
      if (!change) return;
      emitToTenant(tenantDbName, "data:changed", { ...change, by: req.user?.userId ?? null, at: Date.now() });
    } catch {
      // A missed notice only means a screen refreshes on its own timer instead.
    }
  });
  next();
};
