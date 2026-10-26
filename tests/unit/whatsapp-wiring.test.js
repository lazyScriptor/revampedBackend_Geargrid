import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import router from "../../src/routes/whatsappRoutes.js";
import { up, down } from "../../migrations/tenant/20261027100000-whatsapp-hub.js";

const root = path.resolve(__dirname, "../..");

describe("WhatsApp routes", () => {
  const routes = router.stack
    .filter((l) => l.route)
    .map((l) => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path, handlers: l.route.stack.length }));
  const has = (method, p) => routes.some((r) => r.method === method && r.path === p);

  it("exposes the full hub API", () => {
    for (const [m, p] of [
      ["GET", "/worklist"],
      ["POST", "/compose"],
      ["POST", "/log"],
      ["PATCH", "/log/:id/sent"],
      ["GET", "/log"],
      ["GET", "/templates"],
      ["PUT", "/templates/:key/:language"],
      ["DELETE", "/templates/:key/:language"],
      ["GET", "/settings"],
      ["PUT", "/settings"],
      ["PATCH", "/customers/:id/opt-out"],
    ]) {
      expect(has(m, p), `${m} ${p}`).toBe(true);
    }
  });

  it("guards every route with a permission check before the controller", () => {
    for (const r of routes) expect(r.handlers, `${r.method} ${r.path}`).toBeGreaterThanOrEqual(2);
  });

  it("is mounted under /api/whatsapp", () => {
    const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
    expect(app).toContain('app.use("/api/whatsapp", whatsappRoutes)');
  });
});

describe("permission catalogs", () => {
  it.each(["src/scripts/seedPermissions.js", "src/services/superAdminTenantService.js"])("%s lists both WhatsApp permissions (new tenants)", (file) => {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    expect(text).toContain('"whatsapp:send"');
    expect(text).toContain('"whatsapp:manage"');
  });
});

// ─── the tenant migration against a recording fake ───────────────────────────

function fakeDb({ existingTables = [], hasOptOut: initialOptOut = false } = {}) {
  let hasOptOut = initialOptOut;
  const calls = { createTable: [], addIndex: [], addColumn: [], dropTable: [], removeColumn: [], inserts: [], grants: [] };
  const perms = new Map(); // code -> id
  let nextPerm = 100;
  const granted = new Set();
  const tables = ["permissions", "roles", "ROLE_PERMISSIONs", ...existingTables];
  const sequelize = {
    query: async (sql, opts = {}) => {
      const r = opts.replacements || [];
      if (/^SHOW TABLES/i.test(sql)) return [tables.map((t) => ({ Tables_in_db: t }))];
      if (/FROM `permissions` WHERE permission_code = 'invoice:view'/.test(sql)) return [[{ permission_id: 1 }]];
      if (/SELECT permission_id FROM `permissions` WHERE permission_code = \?/.test(sql)) return [perms.has(r[0]) ? [{ permission_id: perms.get(r[0]) }] : []];
      if (/INSERT INTO `permissions`/.test(sql)) {
        const id = nextPerm++;
        perms.set(r[0], id);
        calls.inserts.push(r[0]);
        return [id];
      }
      if (/FROM `roles` WHERE hierarchy_level/.test(sql)) return [[{ role_id: 1 }, { role_id: 2 }]];
      if (/SELECT role_id FROM `ROLE_PERMISSIONs` WHERE permission_id = \?/.test(sql)) return [[{ role_id: 3 }, { role_id: 1 }]]; // role 1 is also an admin
      if (/SELECT 1 FROM `ROLE_PERMISSIONs`/.test(sql)) return [granted.has(`${r[0]}:${r[1]}`) ? [{ 1: 1 }] : []];
      if (/INSERT INTO `ROLE_PERMISSIONs`/.test(sql)) {
        granted.add(`${r[0]}:${r[1]}`);
        calls.grants.push([r[0], r[1]]);
        return [0];
      }
      if (/DELETE FROM/.test(sql)) return [0];
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  const qi = {
    sequelize,
    showAllTables: async () => tables,
    createTable: async (name) => {
      calls.createTable.push(name);
      tables.push(name);
    },
    addIndex: async (table, cols, o) => calls.addIndex.push([table, cols, o?.name]),
    describeTable: async () => (hasOptOut ? { whatsapp_opt_out: {} } : { customer_id: {} }),
    addColumn: async (t, c) => {
      calls.addColumn.push([t, c]);
      if (c === "whatsapp_opt_out") hasOptOut = true;
    },
    removeColumn: async (t, c) => calls.removeColumn.push([t, c]),
    dropTable: async (t) => {
      calls.dropTable.push(t);
    },
  };
  return { qi, calls, perms, granted };
}

describe("migration 20261027100000-whatsapp-hub", () => {
  it("creates both tables, the opt-out column and the permissions on a fresh tenant", async () => {
    const { qi, calls, perms } = fakeDb();
    await up({ context: qi });
    expect(calls.createTable).toEqual(["WHATSAPP_MESSAGE_LOGS", "WHATSAPP_TEMPLATES"]);
    expect(calls.addIndex.map((i) => i[2])).toEqual(expect.arrayContaining(["idx_wa_log_customer", "idx_wa_log_invoice", "uq_wa_template_key_lang"]));
    expect(calls.addColumn).toEqual([["CUSTOMERS", "whatsapp_opt_out"]]);
    expect([...perms.keys()].sort()).toEqual(["whatsapp:manage", "whatsapp:send"]);
  });

  it("grants send+manage to admin roles and send to everyone who can view invoices", async () => {
    const { qi, calls, perms } = fakeDb();
    await up({ context: qi });
    const send = perms.get("whatsapp:send");
    const manage = perms.get("whatsapp:manage");
    const has = (role, perm) => calls.grants.some(([r, p]) => r === role && p === perm);
    expect(has(1, send) && has(1, manage)).toBe(true); // admin
    expect(has(2, send) && has(2, manage)).toBe(true); // another admin-level role
    expect(has(3, send)).toBe(true); // invoice viewer
    expect(has(3, manage)).toBe(false); // …but cannot edit templates
    // role 1 is both admin and viewer: granted exactly once
    expect(calls.grants.filter(([r, p]) => r === 1 && p === send)).toHaveLength(1);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const { qi, calls } = fakeDb();
    await up({ context: qi });
    const snapshot = JSON.stringify(calls);
    await up({ context: qi });
    expect(JSON.stringify(calls)).toBe(snapshot);
  });

  it("skips tables and the column that already exist (tenants created from the models)", async () => {
    const { qi, calls } = fakeDb({ existingTables: ["WHATSAPP_MESSAGE_LOGS", "WHATSAPP_TEMPLATES"], hasOptOut: true });
    await up({ context: qi });
    expect(calls.createTable).toEqual([]);
    expect(calls.addColumn).toEqual([]);
    expect(calls.inserts).toHaveLength(2); // permissions still ensured
  });

  it("down removes what up added", async () => {
    const { qi, calls } = fakeDb({ hasOptOut: true });
    await up({ context: qi });
    await down({ context: qi });
    expect(calls.dropTable).toEqual(["WHATSAPP_TEMPLATES", "WHATSAPP_MESSAGE_LOGS"]);
    expect(calls.removeColumn).toEqual([["CUSTOMERS", "whatsapp_opt_out"]]);
  });
});
