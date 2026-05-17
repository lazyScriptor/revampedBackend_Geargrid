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
2. **Schema changes on existing columns** — Sequelize `sync()` only creates missing tables/columns; it will **not** ALTER existing columns. Run a manual `ALTER TABLE` (template in `scratch/fix_tc_schema.mjs`) for type/default/auto-increment changes.
3. **Smoke test the endpoint** with the correct `Origin: http://localhost:5173` header — CORS is dynamic.

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
