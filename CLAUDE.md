# CLAUDE.md — GearGrid Backend (`revampedBackend_Geargrid`)

> **Service Identity:** Multi-tenant Node.js 22 + Express 5 + Sequelize 6 + MySQL 8 + Socket.IO REST & Real-Time API server for the GearGrid B2B Equipment Rental Platform.
> **Default Port:** `8086` (`http://localhost:8086` locally, `https://api.geargrid.live` in production).

---

## 1. Essential Commands

```bash
# Development & Execution
npm run dev                  # Start server with nodemon (src/server.js) on port 8086
npm start                    # Production start (node src/server.js)

# Testing (Vitest)
npm test                     # Run all 9 test suites (40+ unit & service tests) once
npm run test:watch           # Run Vitest in interactive watch mode

# Database Migrations (Umzug — Master + All Active Tenant DBs)
npm run db:migrate           # Apply pending migrations to geargrid_master AND all geargrid_<slug> DBs
npm run db:migrate:status    # Show applied and pending migrations across all databases
npm run db:migrate:undo      # Revert the most recent migration across Master/Tenant DBs

# Database Seeding & Provisioning
npm run db:seed              # Seed geargrid_master + default tenant with roles, permissions, & demo data
```

---

## 2. Directory & Module Architecture

```
revampedBackend_Geargrid/
├── src/
│   ├── app.js                        # Express 5 app setup, CORS, helmet, cookie-parser, route mounting
│   ├── server.js                     # HTTP server bootstrap, Socket.IO initialization, cron & worker startup
│   ├── config/
│   │   ├── database.js               # Master Sequelize instance (geargrid_master)
│   │   ├── tenantConnectionManager.js# Dynamic LRU cache of Tenant Sequelize instances + model binding
│   │   ├── migrator.js               # Umzug programmatic migration runner (Master + Tenant schemas)
│   │   └── storage.js                # Multer / local & cloud upload storage configuration
│   ├── controllers/                  # Express route handlers (thin layer: parse req -> call service -> send res)
│   │   ├── authController.js         # Tenant login, logout, token refresh, global user lookup
│   │   ├── customerController.js     # Customer CRUD, loyalty points, fast search, /:id/invoices history
│   │   ├── invoiceController.js      # POS dispatch, partial/full returns, payments, vault toggle, print logs
│   │   ├── equipmentController.js    # Inventory CRUD, serial availability, maintenance transfer
│   │   ├── categoryController.js     # Equipment categories & dynamic spec field definitions
│   │   ├── defectController.js       # Defect / maintenance ticket lifecycle & repair resolution
│   │   ├── expenseController.js      # Operational & maintenance expense ledger
│   │   ├── reportController.js       # Overview, financial, equipment, customer, invoice & print audit reports
│   │   ├── dashboardController.js    # Role-based dashboard widget data & user layout preferences
│   │   ├── userController.js         # Workforce management, role assignments, solo-admin guard
│   │   ├── roleController.js         # Custom RBAC roles & permission matrix management
│   │   ├── permissionController.js   # Granular permission catalog & per-user overrides
│   │   ├── warehouseController.js    # Multi-branch / warehouse location management
│   │   ├── bulkJobController.js      # Async CSV/Excel bulk import (with dry-run) & export jobs
│   │   ├── notificationController.js # In-app notification listing & mark-as-read
│   │   ├── meController.js           # Current user profile, password change, active permissions
│   │   ├── i18nController.js         # Dynamic translation packs (en / si)
│   │   ├── superAdminController.js   # Platform-wide tenant provisioning, subscriptions, impersonation, audit
│   │   └── publicController.js       # Public landing page inquiries & tenant registration requests
│   ├── middlewares/
│   │   ├── authMiddleware.js         # Dual-layer JWT verification (Cookie OR Bearer token)
│   │   ├── tenantMiddleware.js       # Attaches req.tenantModels & req.tenantSequelize from JWT db_name
│   │   ├── rbacMiddleware.js         # requirePermission('MODULE_ACTION') check with user override support
│   │   ├── superAdminMiddleware.js   # Isolated Super Admin JWT verification (SUPER_ADMIN_JWT_SECRET)
│   │   └── uploadMiddleware.js       # File upload validation (NIC images, avatars, CSV/XLSX imports)
│   ├── models/
│   │   ├── master/                   # 8 Master DB models (geargrid_master)
│   │   └── tenant/                   # 22 Tenant DB models (geargrid_<slug>) + associations.js
│   ├── migrations/
│   │   ├── master/                   # Timestamped Umzug migrations for geargrid_master
│   │   └── tenant/                   # Timestamped Umzug migrations applied to every tenant DB
│   ├── routes/                       # 18 modular Express routers mounted under /api/*
│   ├── services/                     # Core domain logic & atomic Sequelize transactions
│   │   ├── invoiceService.js         # Rental pricing, stock deduction, partial return settlement, deposit wallet
│   │   ├── customerService.js        # Customer search (skip_count fast path), invoice history + stats
│   │   ├── equipmentService.js       # Stock reconciliation, category linking, defect creation
│   │   ├── reportService.js          # Aggregated SQL analytics, time-series revenue, print audit queries
│   │   ├── dashboardService.js       # KPI computation & role template hydration
│   │   ├── bulkImportService.js      # Streaming CSV/XLSX parser, dry-run validation, batch upserts
│   │   ├── bulkExportService.js      # Streaming CSV/XLSX generator for Customers, Equipment, Invoices
│   │   ├── notificationService.js    # Persists DB notifications + emits real-time Socket.IO events
│   │   ├── auditService.js           # Master & tenant security audit logging
│   │   └── tenantProvisioningService.js # Creates new MySQL database, runs Umzug migrations, seeds defaults
│   ├── sockets/
│   │   └── index.js                  # Socket.IO server with tenant:<dbName> and user:<userId> room isolation
│   └── workers/
│       ├── bulkJobWorker.js          # Background worker polling BULK_JOBs every 2s (max 2 concurrent)
│       └── cronJobs.js               # Scheduled overdue invoice checks & temp file cleanup
└── tests/
    └── unit/                         # 9 comprehensive Vitest test suites
```

---

## 3. Complete Database Schema Inventory

### A. Master Database (`geargrid_master` — 8 Models)
Located in `src/models/master/`:
1. **`TENANT` (`TENANTs`):** `tenant_id`, `company_name`, `slug`, `db_name` (`geargrid_<slug>`), `status` (`ACTIVE`, `SUSPENDED`, `TRIAL`), `contact_email`, `contact_phone`, `settings`.
2. **`GLOBAL_USER` (`GLOBAL_USERs`):** Fast lookup directory mapping `email`, `username`, and `phone` to `tenant_id` and `user_id` so users can log in at `/login` without typing a tenant slug.
3. **`SUPER_ADMIN` (`SUPER_ADMINs`):** Platform operators (`admin7@myrental.com`). Completely isolated from tenant users.
4. **`TENANT_SUBSCRIPTION` (`TENANT_SUBSCRIPTIONs`):** Plan tier, billing cycle, max users, max equipment, expiry dates.
5. **`PLATFORM_CONFIG` (`PLATFORM_CONFIGs`):** Global feature flags, maintenance mode, system-wide announcements.
6. **`AUDIT_LOG` (`AUDIT_LOGs`):** Platform-level security & super-admin action trail.
7. **`CONTACT_INQUIRY` (`CONTACT_INQUIRIEs`):** Leads submitted from the public marketing site (`geargrid.live`).
8. **`TRANSLATION_PACK` (`TRANSLATION_PACKs`):** Dynamic i18n key-value overrides for English (`en`) and Sinhala (`si`).

### B. Tenant Database (`geargrid_<slug>` — 22 Models)
Located in `src/models/tenant/` and wired in `src/models/tenant/associations.js`:
1. **`USER` (`USERs`):** Workforce accounts (`user_id`, `username`, `email`, `phone`, `password_hash`, `is_active`, `warehouse_id`).
2. **`ROLE` (`ROLEs`):** RBAC roles (`Administrator`, `Manager`, `Cashier`, `Warehouse Staff`, etc.).
3. **`PERMISSION` (`PERMISSIONs`):** Granular permission codes (e.g., `INVOICE_CREATE`, `INVOICE_RETURN`, `EQUIPMENT_EDIT`, `USER_MANAGE`).
4. **`USER_ROLE_MAP` (`USER_ROLE_MAPs`):** Join table linking `USER` $\leftrightarrow$ `ROLE`.
5. **Join Table `ROLE_PERMISSIONs`:** *(Implicit/Explicit Sequelize join between `ROLE` and `PERMISSION` — note lowercase trailing `s` on Linux MySQL!)*.
6. **`USER_PERMISSION_OVERRIDE` (`USER_PERMISSION_OVERRIDEs`):** Explicit `GRANT` or `DENY` overrides for a specific user on top of their role permissions.
7. **`WAREHOUSE` (`WAREHOUSEs`):** Physical store/branch locations (`warehouse_id`, `name`, `code`, `is_default`).
8. **`TENANT_CONFIG` (`TENANT_CONFIGs`):** Per-tenant business profile, receipt header/footer, tax rates, currency (`LKR`), ID vault defaults.
9. **`EQUIPMENT_CATEGORY` (`EQUIPMENT_CATEGORIEs`):** Categories (`category_id`, `name`, `code_prefix`, `custom_fields` JSON schema).
10. **`EQUIPMENT` (`EQUIPMENTs`):** Rental inventory items (`equipment_id`, `name`, `serial_number`, `category_id`, `daily_rate`, `deposit_amount`, `total_quantity`, `available_quantity`, `rented_quantity`, `maintenance_quantity`, `status`).
11. **`DEFECT_LOG` (`DEFECT_LOGs`):** Damaged/maintenance records linked to `equipment_id` and optionally `invoice_id` (`quantity_affected`, `severity`, `repair_cost`, `status`: `OPEN`, `IN_PROGRESS`, `RESOLVED`, `WRITTEN_OFF`).
12. **`CUSTOMER` (`CUSTOMERs`):** Rental clients (`customer_id`, `name`, `phone`, `nic_passport`, `address`, `loyalty_points`, `rating`, `is_blacklisted`, `nic_front_url`, `nic_back_url`, `customer_photo_url`).
13. **`INVOICE` (`INVOICEs`):** Rental contracts (`invoice_id`, `invoice_number`, `customer_id`, `status`: `ACTIVE`, `PARTIALLY_RETURNED`, `COMPLETED`, `OVERDUE`, `CANCELLED`; `subtotal`, `discount_amount`, `tax_amount`, `extra_Charge`, `damage_fee`, `total_amount`, `amount_paid`, `deposit_held`, `deposit_refunded`, `is_id_retained_currently`, `id_card_status`, `retained_id_type`, `retained_id_number`).
14. **`INVOICE_LINE` (`INVOICE_LINEs`):** Individual rented items (`line_id`, `invoice_id`, `equipment_id`, `quantity`, `returned_quantity`, `damaged_quantity`, `daily_rate`, `rental_days`, `expected_return_date`, `actual_return_date`, `line_total`, `line_status`).
15. **`PAYMENT` (`PAYMENTs`):** Financial ledger entries (`payment_id`, `invoice_id`, `amount`, `payment_method`: `CASH`, `CARD`, `BANK_TRANSFER`, `DEPOSIT_DEDUCTION`; `payment_type`: `RENTAL`, `DEPOSIT`, `SETTLEMENT`, `REFUND`).
16. **`INVOICE_TRACE` (`INVOICE_TRACEs`):** Immutable chronological audit log of every action on an invoice (`CREATED`, `ITEM_RETURNED`, `PAYMENT_ADDED`, `VAULT_TOGGLED`, `PRINTED`).
17. **`INVOICE_REVIEW` (`INVOICE_REVIEWs`):** Post-rental customer rating & notes logged upon invoice completion.
18. **`INVOICE_PRINT_LOG` (`INVOICE_PRINT_LOGs`):** Dedicated thermal bill print audit trail (`print_log_id`, `invoice_id`, `invoice_number`, `printed_by_user_id`, `printed_by_name`, `print_type`: `ORIGINAL` / `REPRINT`, `print_mode`, `printer_name`, `printed_at`).
19. **`EXPENSE` (`EXPENSEs`):** Operational expenses (`expense_id`, `category`, `amount`, `description`, `incurred_at`, `recorded_by`).
20. **`NOTIFICATION` (`NOTIFICATIONs`):** In-app notifications (`notification_id`, `user_id`, `type`, `title`, `message`, `is_read`, `metadata`).
21. **`BULK_JOB` (`BULK_JOBs`):** Async import/export job state machine (`job_id`, `type`: `IMPORT`/`EXPORT`, `entity_type`, `status`: `pending`, `processing`, `awaiting_confirmation`, `completed`, `failed`, `cancelled`, `summary` JSON, `errors` JSON).
22. **`DASHBOARD_TEMPLATE` & `USER_DASHBOARD_PREFERENCE`:** Customizable dashboard widget layouts per role and per user.

---

## 4. Complete REST API Route Map (`src/app.js`)

| Base Path | Router File | Key Endpoints & Capabilities |
| :--- | :--- | :--- |
| `/api/auth` | `authRoutes.js` | `POST /login`, `POST /logout`, `GET /verify` |
| `/api/me` | `meRoutes.js` | `GET /` (profile + resolved permissions), `PATCH /profile`, `POST /change-password` |
| `/api/customers` | `customerRoutes.js` | `GET /` (supports `?search=&limit=&skip_count=true`), `GET /:id`, `GET /:id/invoices` (returns `{ invoices, stats: { total, active, completed } }`), `POST /`, `PUT /:id`, `DELETE /:id` |
| `/api/invoices` | `invoiceRoutes.js` | `GET /` (returns `{ invoices, total, counts: { all, active, completed } }`), `GET /:id`, `POST /` (POS dispatch), `POST /:id/return` (partial/full return + deposit wallet settlement), `POST /:id/payments`, `PATCH /:id/vault` (returns `{ is_id_retained_currently, id_card_status }`), `POST /print-logs`, `GET /print-logs` |
| `/api/equipment` | `equipmentRoutes.js` | `GET /`, `GET /available`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id` |
| `/api/categories` | `categoryRoutes.js` | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id` |
| `/api/defects` | `defectRoutes.js` | `GET /`, `POST /`, `PATCH /:id/resolve`, `DELETE /:id` |
| `/api/expenses` | `expenseRoutes.js` | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id` |
| `/api/reports` | `reportRoutes.js` | `GET /overview`, `GET /financial`, `GET /equipment`, `GET /customers`, `GET /invoices`, `GET /print-audit` |
| `/api/dashboard` | `dashboardRoutes.js` | `GET /metrics`, `GET /preferences`, `PUT /preferences` |
| `/api/users` | `userRoutes.js` | `GET /`, `POST /`, `PUT /:id`, `PATCH /:id/status` (includes solo-admin guard), `DELETE /:id` |
| `/api/roles` | `roleRoutes.js` | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id` |
| `/api/permissions` | `permissionRoutes.js` | `GET /`, `GET /user/:userId`, `PUT /user/:userId` |
| `/api/warehouses` | `warehouseRoutes.js` | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id` |
| `/api/bulk-jobs` | `bulkJobRoutes.js` | `POST /import` (`?dry_run=true`), `POST /:id/confirm`, `POST /:id/cancel`, `POST /export`, `GET /`, `GET /:id`, `GET /:id/download` |
| `/api/notifications`| `notificationRoutes.js`| `GET /`, `PATCH /:id/read`, `PATCH /read-all` |
| `/api/i18n` | `i18nRoutes.js` | `GET /:lang` (`en` / `si`), `PUT /:lang` |
| `/api/super-admin` | `superAdminRoutes.js` | `POST /login`, `GET /tenants`, `POST /tenants` (auto-provisions DB), `PATCH /tenants/:id`, `POST /tenants/:id/impersonate`, `GET /audit-logs`, `GET /inquiries` |
| `/api/public` | `publicRoutes.js` | `POST /contact` (landing page lead capture) |

---

## 5. Critical Backend Engineering Rules & Trap Defenses

### Rule 1: Never Use `sequelize.sync({ alter: true })`
- **Why:** Running `sync({ alter: true })` in MySQL repeatedly adds duplicate unique/foreign keys until table creation or startup crashes with `ER_TOO_MANY_KEYS (1069): Too many keys specified; max 64 keys allowed`.
- **How to Change Schema:**
  1. Create a new migration file in `src/migrations/tenant/YYYYMMDDHHMMSS-description.js` (or `src/migrations/master/`).
  2. Make every migration idempotent: inspect existing columns/indexes with `queryInterface.describeTable('TABLE_NAME')` before calling `addColumn` or `addIndex`.
  3. Run `npm run db:migrate` to apply across `geargrid_master` and all active `geargrid_<slug>` databases.

### Rule 2: Prevent Cartesian Count Inflation on `findAndCountAll`
- **Why:** In `invoiceService.js` (`getAllInvoices`), `INVOICE` includes `lines` (`hasMany`) and `payments` (`hasMany`). Without `distinct: true`, Sequelize's `COUNT(*)` counts joined child rows instead of unique invoices.
- **Pattern:**
  ```javascript
  const { count, rows } = await INVOICE.findAndCountAll({
    where: whereClause,
    include: [...],
    distinct: true,
    col: 'invoice_id',
    limit,
    offset,
    order: [['createdAt', 'DESC']],
  });
  ```

### Rule 3: Fast-Path Customer Search (`skip_count=true`) & Customer Invoice History
- **POS Customer Search (`customerService.getAllCustomers`):** When `query.skip_count === 'true'` or `true`, execute `CUSTOMER.findAll(...)` without running a `COUNT(*)` query. This keeps POS customer autocomplete under `15ms`.
- **Customer Invoice History (`customerService.getCustomerInvoices`):** `GET /api/customers/:id/invoices` fetches the customer's recent 50 invoices with `INVOICE_LINE` (`EQUIPMENT`) and `PAYMENT` includes and computes `{ total, active, completed }` counts in a single service call.

### Rule 4: Parallel Status Counts in `invoiceService.getAllInvoices`
- **Why:** The Manage Orders UI displays status tabs (`All`, `Active`, `Completed`) while only fetching `limit=20` invoices per page. Computing tab counts on the frontend from `invoices.length` produced wrong numbers (e.g., showing `1` instead of `40` completed invoices).
- **Pattern:** `getAllInvoices` executes parallel `INVOICE.count()` queries for `all`, `active` (`ACTIVE`, `PARTIALLY_RETURNED`, `OVERDUE`), and `completed` (`COMPLETED`) scoped to the same search/customer filter, returning `{ total: count, counts: { all, active, completed }, invoices: rows }`.

### Rule 5: Vault ID Toggle (`toggleVaultStatus`) Contract
- **Endpoint:** `PATCH /api/invoices/:id/vault`
- **Behavior:** Toggles `is_id_retained_currently` (`true` $\leftrightarrow$ `false`), updates `id_card_status` (`RETAINED` $\leftrightarrow$ `RETURNED`), logs an `INVOICE_TRACE` entry, and returns `{ is_id_retained_currently, id_card_status, message }` immediately so the frontend optimistic update settles cleanly.

### Rule 6: Deposit Wallet Accounting in `processPartialReturn`
- Always execute return settlements inside `const t = await sequelize.transaction()`.
- When items are returned with damage fees, extra charges, or overdue days:
  1. Increment `EQUIPMENT.available_quantity` for good items and `EQUIPMENT.maintenance_quantity` + create `DEFECT_LOG` for damaged items.
  2. Deduct unsettled charges from available `deposit_held` if requested (`deductFromDeposit`).
  3. Record `PAYMENT` entries (`REFUND` or `SETTLEMENT`) and update `invoice.deposit_refunded` and `invoice.amount_paid`.
  4. Transition `invoice.status` to `'COMPLETED'` only when every `INVOICE_LINE` has `returned_quantity + damaged_quantity >= quantity` AND remaining balance is settled.

### Rule 7: Socket.IO Multi-Tenant Room Isolation
- Located in `src/sockets/index.js`.
- On connection, JWT is verified and the socket joins:
  - `tenant:${decoded.db_name}` (for tenant-wide broadcasts like inventory updates or bulk job progress)
  - `user:${decoded.user_id}` (for personal notifications)
- **Never** use `io.emit()` globally; always target `io.to(\`tenant:\${dbName}\`).emit(...)` or `io.to(\`user:\${userId}\`).emit(...)`.

---

## 6. Testing Architecture (`tests/unit/`)

All backend changes must maintain 100% pass rate across the Vitest suite (`npm test`):
- `tests/unit/auth-and-security.test.js`: Dual-layer JWT extraction, Super Admin isolation, RBAC permission evaluation.
- `tests/unit/customer-invoices-and-counts.test.js`: `skip_count` fast path, `getCustomerInvoices` stats, parallel invoice status counts, `toggleVaultStatus` response contract.
- `tests/unit/deposit-wallet.test.js`: Deposit collection, damage deduction, refund conservation invariants.
- `tests/unit/equipment-lifecycle.test.js`: Stock reservation on dispatch, restoration on return, maintenance transfer on damage.
- `tests/unit/invoice-calculations.test.js`: Multi-day rental math, discounts, extra charges, overdue penalties.
- `tests/unit/migration-integrity.test.js`: Validates Umzug migration syntax and idempotency guards.
- `tests/unit/print-audit-log.test.js`: `ORIGINAL` vs `REPRINT` detection and audit logging.
- `tests/unit/rbac-solo-admin.test.js`: Prevents deactivating or demoting the last active administrator.
- `tests/unit/tenant-isolation.test.js`: Verifies zero cross-tenant connection leakage in `tenantConnectionManager`.
