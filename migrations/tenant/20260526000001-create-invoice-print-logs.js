// migrations/tenant/20260526000001-create-invoice-print-logs.js
// Adds INVOICE_PRINT_LOGS table to record complete audit history of all bill prints.
// Seeds the fine-grained permission 'invoice:print_log:view' and grants it to high-privilege roles.

import { DataTypes } from "sequelize";

export const up = async ({ context: queryInterface }) => {
  // 1. Create INVOICE_PRINT_LOGS table
  await queryInterface.createTable("INVOICE_PRINT_LOGS", {
    log_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    invoice_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    doc_number: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    doc_type: {
      type: DataTypes.ENUM("DISPATCH", "COMPLETED", "DRAFT", "RETURN_SETTLEMENT"),
      defaultValue: "DISPATCH",
      allowNull: false,
    },
    printed_by_user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    printed_by_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    printed_by_role: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    customer_name: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    customer_phone: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    print_method: {
      type: DataTypes.ENUM("direct_agent", "browser_dialog"),
      defaultValue: "direct_agent",
      allowNull: false,
    },
    printer_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    paper_width: {
      type: DataTypes.STRING(10),
      defaultValue: "80mm",
      allowNull: false,
    },
    copies: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      allowNull: false,
    },
    height_mm: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    total_items: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    total_machines: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    subtotal: {
      type: DataTypes.DECIMAL(12, 2),
      defaultValue: 0.0,
      allowNull: false,
    },
    transport_fee: {
      type: DataTypes.DECIMAL(12, 2),
      defaultValue: 0.0,
      allowNull: false,
    },
    discount_amount: {
      type: DataTypes.DECIMAL(12, 2),
      defaultValue: 0.0,
      allowNull: false,
    },
    grand_total: {
      type: DataTypes.DECIMAL(12, 2),
      defaultValue: 0.0,
      allowNull: false,
    },
    total_paid: {
      type: DataTypes.DECIMAL(12, 2),
      defaultValue: 0.0,
      allowNull: false,
    },
    balance_due: {
      type: DataTypes.DECIMAL(12, 2),
      defaultValue: 0.0,
      allowNull: false,
    },
    language: {
      type: DataTypes.STRING(10),
      defaultValue: "en",
      allowNull: false,
    },
    custom_notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    bill_snapshot: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    ip_address: {
      type: DataTypes.STRING(45),
      allowNull: true,
    },
    printed_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  });

  // 2. Indexes
  await queryInterface.addIndex("INVOICE_PRINT_LOGS", ["invoice_id"]);
  await queryInterface.addIndex("INVOICE_PRINT_LOGS", ["printed_by_user_id"]);
  await queryInterface.addIndex("INVOICE_PRINT_LOGS", ["doc_number"]);
  await queryInterface.addIndex("INVOICE_PRINT_LOGS", ["printed_at"]);

  // 3. Seed 'invoice:print_log:view' permission into PERMISSIONS if not present
  try {
    const [existing] = await queryInterface.sequelize.query(
      "SELECT permission_id FROM PERMISSIONS WHERE permission_code = 'invoice:print_log:view' LIMIT 1"
    );

    let permId = existing && existing[0]?.permission_id;
    if (!permId) {
      const [insertResult] = await queryInterface.sequelize.query(
        "INSERT INTO PERMISSIONS (permission_code, module_name, description) VALUES ('invoice:print_log:view', 'Invoices', 'View POS bill printing audit logs')"
      );
      permId = insertResult;
    }

    // 4. Grant permission to Admin / Owner roles (hierarchy_level >= 50 or role_name LIKE '%admin%')
    if (permId) {
      const [adminRoles] = await queryInterface.sequelize.query(
        "SELECT role_id FROM ROLES WHERE hierarchy_level >= 50 OR LOWER(role_name) LIKE '%admin%' OR LOWER(role_name) LIKE '%owner%'"
      );

      for (const role of adminRoles) {
        const [hasRolePerm] = await queryInterface.sequelize.query(
          "SELECT * FROM ROLE_PERMISSIONS WHERE role_id = :roleId AND permission_id = :permId LIMIT 1",
          { replacements: { roleId: role.role_id, permId } }
        );
        if (!hasRolePerm || hasRolePerm.length === 0) {
          await queryInterface.sequelize.query(
            "INSERT INTO ROLE_PERMISSIONS (role_id, permission_id) VALUES (:roleId, :permId)",
            { replacements: { roleId: role.role_id, permId } }
          );
        }
      }
    }
  } catch (err) {
    console.warn("Permission seeding during migration had non-fatal notice:", err.message);
  }
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.dropTable("INVOICE_PRINT_LOGS");
};
