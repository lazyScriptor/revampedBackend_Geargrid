import { DataTypes } from "sequelize";
import {
  addColumnIfMissing,
  addIndexIfMissing,
  tableExists,
} from "../lib/schemaGuards.js";

const RETAIL_MODULE = "Retail";
const RETAIL_PERMISSIONS = [
  ["retail:view", "View retail products, stock levels and history"],
  ["retail:sell", "Sell retail items on POS bills"],
  ["retail:return", "Process returns of sold retail items"],
  ["retail:price_override", "Override retail item selling prices on a bill"],
  ["retail:discount", "Apply line or bill discounts on retail sales"],
  ["retail:product_manage", "Create, edit and archive retail products, categories, brands and families"],
  ["retail:stock_receive", "Receive retail stock deliveries"],
  ["retail:stock_adjust", "Adjust retail stock and record counts or opening stock"],
  ["retail:cost_view", "View retail item costs and profit margins"],
  ["retail:reports", "View retail sales, stock and profit reports"],
  ["retail:add_unlisted", "Add unlisted items at the POS counter"],
  ["retail:confirm_unlisted", "Link, create or confirm unlisted retail sales on the Manager desk"],
];

const resolveTable = async (sequelize, preferred, fallback) => {
  const [tables] = await sequelize.query("SHOW TABLES");
  const names = tables.map((t) => Object.values(t)[0]);
  return (
    names.find((t) => t === preferred) ||
    names.find((t) => t.toLowerCase() === preferred.toLowerCase()) ||
    fallback ||
    preferred
  );
};

export const up = async ({ context: qi }) => {
  const sequelize = qi.sequelize;

  // 1. INVOICES columns + backfill rental_total = sub_total on first add
  const invoicesTable = await resolveTable(sequelize, "INVOICES", "INVOICES");
  await addColumnIfMissing(qi, invoicesTable, "bill_kind", {
    type: DataTypes.ENUM("rental", "sale", "mixed"),
    allowNull: false,
    defaultValue: "rental",
  });
  await addColumnIfMissing(qi, invoicesTable, "sale_total", {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  });
  const addedRentalTotal = await addColumnIfMissing(qi, invoicesTable, "rental_total", {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  });
  if (addedRentalTotal) {
    await sequelize.query(
      `UPDATE \`${invoicesTable}\` SET rental_total = COALESCE(sub_total, 0)`,
    );
  }
  await addColumnIfMissing(qi, invoicesTable, "job_site", {
    type: DataTypes.STRING(120),
    allowNull: true,
  });
  await addColumnIfMissing(qi, invoicesTable, "customer_po", {
    type: DataTypes.STRING(60),
    allowNull: true,
  });

  // 2. CUSTOMERS columns
  const customersTable = await resolveTable(sequelize, "CUSTOMERS", "CUSTOMERS");
  await addColumnIfMissing(qi, customersTable, "is_walk_in", {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await addColumnIfMissing(qi, customersTable, "price_level", {
    type: DataTypes.ENUM("retail", "contractor", "trade"),
    allowNull: false,
    defaultValue: "retail",
  });

  // 3. USERS columns
  const usersTable = await resolveTable(sequelize, "USERS", "USERS");
  await addColumnIfMissing(qi, usersTable, "approval_pin_hash", {
    type: DataTypes.STRING(255),
    allowNull: true,
  });
  await addColumnIfMissing(qi, usersTable, "pin_failed_count", {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  });
  await addColumnIfMissing(qi, usersTable, "pin_locked_until", {
    type: DataTypes.DATE,
    allowNull: true,
  });

  // 4. COUNTER_EXCEPTIONS
  if (!(await tableExists(qi, "COUNTER_EXCEPTIONS"))) {
    await qi.createTable("COUNTER_EXCEPTIONS", {
      exception_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      type: {
        type: DataTypes.ENUM(
          "unlisted_item",
          "price_change",
          "discount_over_limit",
          "below_cost",
          "negative_stock",
          "return_no_bill",
          "line_removed",
          "bill_void_after_print",
          "credit_over_limit",
          "backdated_bill",
          "drawer_open",
        ),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("recorded", "waiting", "approved", "declined", "sorted"),
        allowNull: false,
        defaultValue: "recorded",
      },
      invoice_id: { type: DataTypes.INTEGER, allowNull: true },
      sale_line_id: { type: DataTypes.INTEGER, allowNull: true },
      product_id: { type: DataTypes.INTEGER, allowNull: true },
      requested_by: { type: DataTypes.INTEGER, allowNull: false },
      approved_by: { type: DataTypes.INTEGER, allowNull: true },
      old_value: { type: DataTypes.JSON, allowNull: true },
      new_value: { type: DataTypes.JSON, allowNull: true },
      amount_impact: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      summary: { type: DataTypes.STRING(500), allowNull: true },
      note: { type: DataTypes.STRING(500), allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: true },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      resolved_at: { type: DataTypes.DATE, allowNull: true },
    });
  }
  await addIndexIfMissing(qi, "COUNTER_EXCEPTIONS", ["status", "created_at"], {
    name: "idx_counter_exceptions_status_created",
  });
  await addIndexIfMissing(qi, "COUNTER_EXCEPTIONS", ["type", "created_at"], {
    name: "idx_counter_exceptions_type_created",
  });
  await addIndexIfMissing(qi, "COUNTER_EXCEPTIONS", ["requested_by"], {
    name: "idx_counter_exceptions_requested_by",
  });

  // 5. APPROVAL_TOKENS (SHA-256 hash only)
  if (!(await tableExists(qi, "APPROVAL_TOKENS"))) {
    await qi.createTable("APPROVAL_TOKENS", {
      token_hash: {
        type: DataTypes.STRING(64),
        primaryKey: true,
      },
      exception_id: { type: DataTypes.INTEGER, allowNull: true },
      action: { type: DataTypes.STRING(40), allowNull: false },
      approver_user_id: { type: DataTypes.INTEGER, allowNull: false },
      requester_user_id: { type: DataTypes.INTEGER, allowNull: false },
      context: { type: DataTypes.JSON, allowNull: true },
      context_hash: { type: DataTypes.STRING(64), allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      used_at: { type: DataTypes.DATE, allowNull: true },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }
  await addIndexIfMissing(qi, "APPROVAL_TOKENS", ["expires_at"], {
    name: "idx_approval_tokens_expires_at",
  });
  await addIndexIfMissing(qi, "APPROVAL_TOKENS", ["exception_id"], {
    name: "idx_approval_tokens_exception_id",
  });

  // 6. IDEMPOTENCY_KEYS
  if (!(await tableExists(qi, "IDEMPOTENCY_KEYS"))) {
    await qi.createTable("IDEMPOTENCY_KEYS", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      key: { type: DataTypes.STRING(128), allowNull: false },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      route: { type: DataTypes.STRING(160), allowNull: false },
      request_hash: { type: DataTypes.STRING(64), allowNull: false },
      response_status: { type: DataTypes.INTEGER, allowNull: false },
      response_body: { type: DataTypes.JSON, allowNull: true },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }
  await addIndexIfMissing(qi, "IDEMPOTENCY_KEYS", ["key", "user_id", "route"], {
    unique: true,
    name: "uq_idempotency_key_user_route",
  });
  await addIndexIfMissing(qi, "IDEMPOTENCY_KEYS", ["created_at"], {
    name: "idx_idempotency_created_at",
  });

  // 7. USER_UI_PREFERENCES
  if (!(await tableExists(qi, "USER_UI_PREFERENCES"))) {
    await qi.createTable("USER_UI_PREFERENCES", {
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      pref_key: {
        type: DataTypes.STRING(60),
        allowNull: false,
        primaryKey: true,
      },
      value: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }

  // 8. Permissions (reuses existing approvals:decide; never creates retail:approve)
  const permTable = await resolveTable(sequelize, "PERMISSIONS", "permissions");
  const rolePermTable = await resolveTable(sequelize, "ROLE_PERMISSIONs", "ROLE_PERMISSIONs");
  const rolesTable = await resolveTable(sequelize, "ROLES", "roles");

  const permIds = {};
  for (const [code, description] of RETAIL_PERMISSIONS) {
    const [found] = await sequelize.query(
      `SELECT permission_id FROM \`${permTable}\` WHERE permission_code = ? LIMIT 1`,
      { replacements: [code] },
    );
    if (found[0]) {
      permIds[code] = found[0].permission_id;
    } else {
      const [insertId] = await sequelize.query(
        `INSERT INTO \`${permTable}\` (permission_code, module_name, description) VALUES (?, ?, ?)`,
        { replacements: [code, RETAIL_MODULE, description] },
      );
      permIds[code] = insertId;
    }
  }

  const [admins] = await sequelize.query(
    `SELECT role_id FROM \`${rolesTable}\` WHERE hierarchy_level >= 100`,
  );
  for (const r of admins) {
    for (const permId of Object.values(permIds)) {
      const [has] = await sequelize.query(
        `SELECT 1 FROM \`${rolePermTable}\` WHERE role_id = ? AND permission_id = ? LIMIT 1`,
        { replacements: [r.role_id, permId] },
      );
      if (!has[0]) {
        await sequelize.query(
          `INSERT INTO \`${rolePermTable}\` (role_id, permission_id) VALUES (?, ?)`,
          { replacements: [r.role_id, permId] },
        );
      }
    }
  }

  // 9. Built-in Walk-in customer (if none exists)
  const [existingWalkIn] = await sequelize.query(
    `SELECT customer_id FROM \`${customersTable}\` WHERE is_walk_in = 1 OR nic_number = 'WALK-IN' LIMIT 1`,
  );
  if (!existingWalkIn[0]) {
    await sequelize.query(
      `INSERT INTO \`${customersTable}\` (customer_type, nic_number, first_name, last_name, phone_number, is_walk_in, price_level, status, customer_delete_status, createdAt, updatedAt)
       VALUES ('Individual', 'WALK-IN', 'Walk-in', 'customer', '0000000000', 1, 'retail', 'Active', 0, NOW(), NOW())`,
    );
  }
};

export const down = async ({ context: qi }) => {
  const sequelize = qi.sequelize;
  const permTable = await resolveTable(sequelize, "PERMISSIONS", "permissions");
  const rolePermTable = await resolveTable(sequelize, "ROLE_PERMISSIONs", "ROLE_PERMISSIONs");

  for (const [code] of RETAIL_PERMISSIONS) {
    const [found] = await sequelize.query(
      `SELECT permission_id FROM \`${permTable}\` WHERE permission_code = ? LIMIT 1`,
      { replacements: [code] },
    );
    if (found[0]) {
      await sequelize.query(
        `DELETE FROM \`${rolePermTable}\` WHERE permission_id = ?`,
        { replacements: [found[0].permission_id] },
      );
      await sequelize.query(
        `DELETE FROM \`${permTable}\` WHERE permission_id = ?`,
        { replacements: [found[0].permission_id] },
      );
    }
  }

  for (const table of [
    "USER_UI_PREFERENCES",
    "IDEMPOTENCY_KEYS",
    "APPROVAL_TOKENS",
    "COUNTER_EXCEPTIONS",
  ]) {
    if (await tableExists(qi, table)) {
      await qi.dropTable(table);
    }
  }
};
