import { DataTypes, literal } from "sequelize";
import {
  addColumnIfMissing,
  addIndexIfMissing,
  tableExists,
} from "../lib/schemaGuards.js";

export const up = async ({ context: qi }) => {
  // 1. CUSTOMER_SETTLEMENTS table
  if (!(await tableExists(qi, "CUSTOMER_SETTLEMENTS"))) {
    await qi.createTable(
      "CUSTOMER_SETTLEMENTS",
      {
        settlement_id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        customer_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        settled_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal("CURRENT_TIMESTAMP"),
        },
        entered_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal("CURRENT_TIMESTAMP"),
        },
        user_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        return_date: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        payment_total: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: false,
          defaultValue: 0,
        },
        leftover_mode: {
          type: DataTypes.ENUM("credit", "change", "none"),
          allowNull: false,
          defaultValue: "none",
        },
        leftover_amount: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: false,
          defaultValue: 0,
        },
        wallet_used_amount: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: false,
          defaultValue: 0,
        },
        split_rule: {
          type: DataTypes.ENUM("oldest_first", "cheaper_for_customer"),
          allowNull: false,
          defaultValue: "oldest_first",
        },
        note: {
          type: DataTypes.STRING(500),
          allowNull: true,
        },
        is_voided: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        voided_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        voided_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        idempotency_key: {
          type: DataTypes.STRING(128),
          allowNull: true,
        },
        snapshot_json: {
          type: DataTypes.JSON,
          allowNull: true,
        },
      },
      {
        charset: "utf8mb4",
        collate: "utf8mb4_unicode_ci",
      },
    );
  }

  await addIndexIfMissing(qi, "CUSTOMER_SETTLEMENTS", ["customer_id", "settled_at"], {
    name: "idx_customer_settlements_cust_settled",
  });
  await addIndexIfMissing(qi, "CUSTOMER_SETTLEMENTS", ["customer_id", "idempotency_key"], {
    name: "idx_customer_settlements_cust_idem",
  });

  // 2. PAYMENTS.settlement_id (nullable)
  if (await tableExists(qi, "PAYMENTS")) {
    await addColumnIfMissing(qi, "PAYMENTS", "settlement_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
    await addIndexIfMissing(qi, "PAYMENTS", ["settlement_id"], {
      name: "idx_payments_settlement_id",
    });
  }

  // 3. INVOICE_LINES.settlement_id (nullable) + scale index
  if (await tableExists(qi, "INVOICE_LINES")) {
    await addColumnIfMissing(qi, "INVOICE_LINES", "settlement_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
    await addIndexIfMissing(qi, "INVOICE_LINES", ["invoice_id", "equipment_id", "line_status"], {
      name: "idx_invoice_lines_inv_equip_status",
    });
  }

  // 4. INVOICES scale index (customer_id, status, issued_date)
  if (await tableExists(qi, "INVOICES")) {
    await addIndexIfMissing(qi, "INVOICES", ["customer_id", "status", "issued_date"], {
      name: "idx_invoices_customer_status_issued",
    });
  }

  // 5. SETTLEMENT_IDEMPOTENCY_KEYS table (for 24h key reservation & 409 concurrent duplicate)
  if (!(await tableExists(qi, "SETTLEMENT_IDEMPOTENCY_KEYS"))) {
    await qi.createTable(
      "SETTLEMENT_IDEMPOTENCY_KEYS",
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        scope: {
          type: DataTypes.STRING(120),
          allowNull: false,
        },
        idempotency_key: {
          type: DataTypes.STRING(128),
          allowNull: false,
        },
        status: {
          type: DataTypes.ENUM("processing", "completed"),
          allowNull: false,
          defaultValue: "processing",
        },
        response_status: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        response_body: {
          type: DataTypes.JSON,
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal("CURRENT_TIMESTAMP"),
        },
        expires_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
      },
      {
        charset: "utf8mb4",
        collate: "utf8mb4_unicode_ci",
      },
    );
  }

  await addIndexIfMissing(qi, "SETTLEMENT_IDEMPOTENCY_KEYS", ["scope", "idempotency_key"], {
    unique: true,
    name: "uniq_settlement_idempotency_scope_key",
  });
  await addIndexIfMissing(qi, "SETTLEMENT_IDEMPOTENCY_KEYS", ["expires_at"], {
    name: "idx_settlement_idempotency_expires_at",
  });
};

export const down = async ({ context: qi }) => {
  // Additive release-4 migration; down is intentionally a no-op to preserve data.
  void qi;
};
