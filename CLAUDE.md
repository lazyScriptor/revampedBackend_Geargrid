# GearGrid Backend

Multi-tenant equipment-rental SaaS. Node 22 + Express + Sequelize. Each tenant has its own MySQL database; one master DB holds the tenant directory and auth.

## Architecture in 30 seconds

- **Master DB** (`geargrid_master`): `TENANTS` (UUID `tenant_id`), `GLOBAL_USERS` (login email → `target_tenant_id`), `SUPER_ADMINS`, `TENANT_SUBSCRIPTIONS`, `PLATFORM_CONFIG`, `SUPER_ADMIN_AUDIT_LOG`.
- **Tenant DB** (`geargrid_<slug>`): `USERS`, `ROLES`, `PERMISSIONS`, `WAREHOUSES`, `TENANT_CONFIG`, `EQUIPMENT`, `INVOICES`, …
- **Login flow**: email → master `GLOBAL_USERS` → `TENANTS.db_*` → `getTenantConnection()` → load tenant `USERS`/`ROLES`/`PERMISSIONS` → mint JWT with `tenantDbName`. Cookies: `accessToken` (5h), `refreshToken` (7d).
- **Super admin**: separate cookie (`superAdminToken`), separate routes under `/api/super-admin`, separate auth middleware (`protectSuperAdmin`), every write wrapped in `logAuditAction()`.

## Commands

| Task | Command |
|---|---|
| Dev (nodemon) | `npm run dev` |
| Plain start | `node ./src/server.js` |
| Port | 8086 |
| DB creds | `.env` → `USERNAME`, `PASSWORD`, `HOST`, `JWT_SECRET`, `JWT_REFRESH_SECRET` |
| Background log | `/tmp/backend.log` when run with `> /tmp/backend.log 2>&1 &` |
| One-off scripts | put in `scratch/` (gitignored), run with `node scratch/<file>.mjs` |

## Definition of done

1. **Restart the server** — `node ./src/server.js` keeps old code in memory; nothing auto-reloads unless you used `npm run dev`. Confirm new behavior with a `curl` against the real server.
2. **Schema changes go through migrations, not `sync()`.** `sequelize.sync()` only creates missing tables; it does **not** ALTER existing ones. Every model change must be paired with a migration file in `migrations/master/` or `migrations/tenant/` (see "Database migrations" section below). The deploy workflow runs `npm run db:migrate` automatically.
3. **Smoke test the endpoint** with the correct `Origin: http://localhost:5173` header — CORS is dynamic.

## Database migrations

The repo uses [umzug](https://github.com/sequelize/umzug) (the engine behind sequelize-cli) with a multi-tenant runner at `src/scripts/migrate.js`.

```
migrations/
  master/   ← runs against geargrid_master only
  tenant/   ← runs against every tenant DB in TENANTS
```

Each DB tracks state in its own `SequelizeMeta` table, so master and per-tenant migrations are independent.

| Command | What it does |
|---|---|
| `npm run db:migrate` | Apply pending migrations to master + every tenant. Idempotent. |
| `npm run db:migrate:status` | Show applied vs pending per DB. |
| `npm run db:migrate:create master <name>` | Scaffold a new master-DB migration. |
| `npm run db:migrate:create tenant <name>` | Scaffold a new tenant-DB migration. |
| `npm run db:migrate:baseline` | **One-time** — mark every existing migration file as APPLIED without running it. Use on existing DBs after introducing a migration that they already match. |

**Workflow for a schema change:**
1. Edit the model file (e.g. add a column to `Equipment.js`).
2. `npm run db:migrate:create tenant add-equipment-foo` — creates `migrations/tenant/YYYYMMDDHHMMSS-add-equipment-foo.js`.
3. Fill in `up()` (the `ALTER TABLE …`) and `down()` (the inverse).
4. `npm run db:migrate` locally to verify.
5. Commit both the model change and the migration file together. CI runs `npm run db:migrate` on the server before restarting PM2.

**New tenant DBs:** `createTenant()` (in `superAdminTenantService.js`) still uses `conn.sync()` to create all tables from the current models, then calls `baselineTenantMigrations()` to mark every tenant migration file as already-applied. Future migrations after the tenant is created will still run.

## Known traps (re-discovered too many times — written down so we don't again)

- **mysql2 returns `longtext` JSON columns as raw strings**, even when the Sequelize model uses `DataTypes.JSON`. Affected: `TENANTS.branding`, `TENANTS.feature_flags`, `TENANTS.cors_whitelist`, `PLATFORM_CONFIG.config_value`. Always normalize at the API boundary — see `normalizeTenant()` in `src/services/superAdminTenantService.js`.
- **Sequelize key must be camelCase `autoIncrement: true`.** Lowercase `autoincrement` is silently ignored → INSERTs fail with `Field 'foo' doesn't have a default value`.
- **Express body limit** is set to 10MB in `app.js` (default is 100kb — too small for base64 logos / bulk CSVs).
- **CORS is dynamic and combined.** `corsOrigins` in `src/config/cors-config.js` is mutated at runtime. Source of truth = `PLATFORM_CONFIG.cors_origins` ∪ every `TENANTS.cors_whitelist`. Call `recomputeCorsOrigins()` after any change to either.
- **Suspended tenants are blocked at login** (`authService.loginUser` checks `subscription_status`). `Overdue` is not currently blocking — change deliberately if you add that.
- **`SUPER_ADMIN_AUDIT_LOG.target_tenant_id` is `STRING(36)`** (UUID), not INTEGER. Don't "fix" it back.
- **`TenantConfig.logo_url` is `TEXT('long')` (LONGTEXT)** — plain TEXT (~64KB) can't hold base64 images.
- **`getTenantUsers` and similar must tolerate offline tenant DBs** — wrap `getTenantConnection` calls in try/catch and return `[]` rather than crashing the super-admin console.
- **`{...stringValue}` corruption**: if a JSON column comes back as a string and a client does `{...prev}`, the saved object gets numeric-indexed character keys (`{"0":"{","1":"\""…}`). `stripCorruptedSpreadKeys()` in the service file defends against this on write.
- **Never use `sequelize.sync({ alter: true })`.** Each restart re-runs `ALTER TABLE … UNIQUE` and appends a new index (`email_2`, `email_3`, …) until MySQL hits 64 keys/column and refuses (`ER_TOO_MANY_KEYS`). Use migrations instead.

## Conventions

- **Controllers stay thin** — orchestration only. Real work lives in services.
- **Wrap every async controller in `catchAsync`** (`src/utils/catchAsync.js`). Throw `AppError(message, status)` for expected failures; the global error handler does the rest.
- **Master models**: `getMasterModels()` (after `initMasterModels(masterSequelize)` at boot).
- **Tenant models**: `initTenantModels(getCachedTenantConnection(req.user.tenantDbName))`. The cached connection is keyed by DB name and reused.
- **New endpoint**: route → controller → service. Don't import Sequelize models into controllers.
- **Permissions on tenant routes**: `protect` → `requirePermission("xxx:yyy")`. Permission codes are seeded from `scripts/seedPermissions.js`.

## Route map (top-level)

```
/api/auth                 — login / verify / logout
/api/super-admin/*        — protected by protectSuperAdmin; tenant CRUD, billing,
                            user CRUD across tenant DBs, CORS, audit log, logo upload
/api/config               — current tenant's TENANT_CONFIG (read/write)
/api/users, /api/roles, /api/permissions, /api/permission-management
/api/equipment, /api/equipment/bulk, /api/categories, /api/defects
/api/customers, /api/customers/bulk
/api/invoices, /api/invoices/bulk
/api/dashboard, /api/reports, /api/expenses, /api/accounting, /api/contact
/uploads/*                — static; tenant logos at /uploads/logos/<id>-<ts>.<ext>
```

## File uploads

Multer config lives **with the route** (not a shared middleware). Existing patterns:
- CSVs: `multer.memoryStorage()` (e.g. `routes/bulkEquipmentRoutes.js`).
- Images: `multer.diskStorage()` writing to `uploads/<topic>/`, 5MB cap, MIME-type filter (e.g. logo upload in `routes/superAdminRoutes.js`).

Served via `app.use("/uploads", express.static("uploads"))` in `app.js`.
