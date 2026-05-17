// ─────────────────────────────────────────────────────────────────────────────
// Migration runner — multi-tenant aware
//
// Subcommands:
//   node src/scripts/migrate.js up                  Run pending migrations on master + every tenant
//   node src/scripts/migrate.js status              Show pending vs applied on every DB
//   node src/scripts/migrate.js baseline            Mark every existing migration as APPLIED without
//                                                   running it. Use this once on an existing prod DB so
//                                                   the framework starts tracking only NEW migrations.
//   node src/scripts/migrate.js create master <name>   Scaffold a new master-DB migration
//   node src/scripts/migrate.js create tenant <name>   Scaffold a new tenant-DB migration
//
// Migration files live in migrations/master/ and migrations/tenant/ and use the
// umzug v3 format: `export const up = async ({ context }) => { ... }`.
// `context` is the Sequelize QueryInterface for the relevant DB.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { Umzug, SequelizeStorage } from "umzug";
import { QueryTypes } from "sequelize";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  masterSequelize,
  getTenantConnection,
} from "../config/database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MASTER_DIR = path.join(ROOT, "migrations", "master");
const TENANT_DIR = path.join(ROOT, "migrations", "tenant");

// ─── Umzug factory ───────────────────────────────────────────────────────────
// Umzug v3 wants migrations as `{ glob, resolve }` (object form), not an array
// of objects with per-entry resolve functions. The closure on `context` is what
// umzug actually awaits — up()/down() take no args.
const buildUmzug = (sequelize, dir, label) => {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js") || f.endsWith(".cjs"))
    .map((f) => path.join(dir, f))
    .sort();

  return new Umzug({
    migrations: files.map((filePath) => {
      const name = path.basename(filePath);
      // Lazy-load the migration module via file:// URL (ESM requirement).
      const load = () => import(pathToFileURL(filePath).href);
      return {
        name,
        up: async ({ context }) => {
          const mod = await load();
          if (typeof mod.up !== "function") {
            throw new Error(`Migration ${name} is missing an exported up() function`);
          }
          return mod.up({ context });
        },
        down: async ({ context }) => {
          const mod = await load();
          if (typeof mod.down !== "function") {
            throw new Error(`Migration ${name} is missing an exported down() function`);
          }
          return mod.down({ context });
        },
      };
    }),
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize, modelName: "SequelizeMeta" }),
    logger: {
      info: (m) => console.log(`[${label}] ${m.event ?? ""} ${m.name ?? ""}`),
      warn: (m) => console.warn(`[${label}]`, m),
      error: (m) => console.error(`[${label}]`, m),
      debug: () => {},
    },
  });
};

// ─── Helpers ────────────────────────────────────────────────────────────────
const listTenants = async () => {
  const tenants = await masterSequelize.query(
    "SELECT db_name, db_user, encrypted_db_pass, db_host FROM TENANTS",
    { type: QueryTypes.SELECT },
  );
  return tenants;
};

const withTenantUmzug = async (tenant, fn) => {
  const conn = await getTenantConnection(
    tenant.db_name,
    tenant.db_user,
    tenant.encrypted_db_pass,
    tenant.db_host,
  );
  const umzug = buildUmzug(conn, TENANT_DIR, `tenant:${tenant.db_name}`);
  try {
    return await fn(umzug, conn);
  } finally {
    // Cached connections are reused by the rest of the app — don't close them here.
  }
};

// ─── Commands ────────────────────────────────────────────────────────────────
const cmdUp = async () => {
  console.log("→ master DB");
  const master = buildUmzug(masterSequelize, MASTER_DIR, "master");
  await master.up();

  const tenants = await listTenants();
  for (const t of tenants) {
    console.log(`→ tenant: ${t.db_name}`);
    try {
      await withTenantUmzug(t, async (umzug) => umzug.up());
    } catch (err) {
      console.error(`  ✗ ${t.db_name} failed:`, err.message);
    }
  }
  console.log("✅ migrations complete");
};

const cmdStatus = async () => {
  const print = async (label, umzug) => {
    const applied = (await umzug.executed()).map((m) => m.name);
    const pending = (await umzug.pending()).map((m) => m.name);
    console.log(`\n[${label}]`);
    console.log(`  applied (${applied.length}):`, applied.join(", ") || "—");
    console.log(`  pending (${pending.length}):`, pending.join(", ") || "—");
  };

  await print("master", buildUmzug(masterSequelize, MASTER_DIR, "master"));
  const tenants = await listTenants();
  for (const t of tenants) {
    try {
      await withTenantUmzug(t, async (umzug) =>
        print(`tenant:${t.db_name}`, umzug),
      );
    } catch (err) {
      console.error(`  ✗ ${t.db_name}:`, err.message);
    }
  }
};

// Mark every existing migration as APPLIED without running it.
// Used once on an existing DB so future-only migrations are picked up.
const cmdBaseline = async () => {
  const markAll = async (sequelize, dir, label) => {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".js") || f.endsWith(".cjs"))
      .sort();
    if (files.length === 0) {
      console.log(`[${label}] no migration files to baseline`);
      return;
    }
    const umzug = buildUmzug(sequelize, dir, label);
    // umzug creates the storage table on first executed() call
    await umzug.executed();
    const applied = new Set((await umzug.executed()).map((m) => m.name));
    for (const f of files) {
      if (applied.has(f)) continue;
      await sequelize.query(
        "INSERT INTO `SequelizeMeta` (`name`) VALUES (:name)",
        { replacements: { name: f } },
      );
      console.log(`[${label}] baselined ${f}`);
    }
  };

  console.log("→ master DB baseline");
  await markAll(masterSequelize, MASTER_DIR, "master");

  const tenants = await listTenants();
  for (const t of tenants) {
    console.log(`→ tenant baseline: ${t.db_name}`);
    try {
      const conn = await getTenantConnection(
        t.db_name,
        t.db_user,
        t.encrypted_db_pass,
        t.db_host,
      );
      await markAll(conn, TENANT_DIR, `tenant:${t.db_name}`);
    } catch (err) {
      console.error(`  ✗ ${t.db_name}:`, err.message);
    }
  }
  console.log("✅ baseline complete");
};

const cmdCreate = async (scope, name) => {
  if (!["master", "tenant"].includes(scope)) {
    console.error(`scope must be 'master' or 'tenant' (got '${scope}')`);
    process.exit(2);
  }
  if (!name) {
    console.error("migration name required");
    process.exit(2);
  }
  const ts = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const filename = `${ts}-${slug}.js`;
  const dir = scope === "master" ? MASTER_DIR : TENANT_DIR;
  const filepath = path.join(dir, filename);

  const template = `// ${filename}
// ${scope} DB migration — describe what this changes and WHY.

export const up = async ({ context: queryInterface }) => {
  // Example:
  // await queryInterface.addColumn('TABLE_NAME', 'new_col', {
  //   type: Sequelize.STRING,
  //   allowNull: true,
  // });
};

export const down = async ({ context: queryInterface }) => {
  // Inverse of up(). Required so we can roll back if needed.
};
`;
  fs.writeFileSync(filepath, template);
  console.log(`✅ created ${path.relative(ROOT, filepath)}`);
};

// ─── Entry ───────────────────────────────────────────────────────────────────
const [, , cmd, ...rest] = process.argv;
const run = async () => {
  switch (cmd) {
    case "up":
      return cmdUp();
    case "status":
      return cmdStatus();
    case "baseline":
      return cmdBaseline();
    case "create":
      return cmdCreate(rest[0], rest[1]);
    default:
      console.error(
        "Usage: node src/scripts/migrate.js <up|status|baseline|create>",
      );
      process.exit(2);
  }
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration runner crashed:", err);
    process.exit(1);
  });
