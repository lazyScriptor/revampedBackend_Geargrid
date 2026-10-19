// migrations/tenant/20261019120000-create-signature-tables.js
//
// Introduces the mobile-phone signature capture subsystem:
//   • SIGNATURE_REQUESTS  — short-lived capture sessions (token + status)
//   • INVOICE_SIGNATURES  — captured signatures (PNG url + audit metadata)
//   • USERS.signature_url / signature_captured_at — operator saved signature
//   • TENANT_CONFIG.rental_terms_markdown / rental_terms_version — per-tenant
//     terms shown on the mobile sign page, versioned so historical signatures
//     always know what wording they agreed to.
//   • Seeds three permissions: invoice:signature:request, invoice:signature:view,
//     user:signature:manage_own — granted to Admin/Owner-level roles.
//
// Fully idempotent: inspects schema before every DDL so re-running on a
// partially-migrated DB is safe. Uses the lowercase-suffixed table name
// "ROLE_PERMISSIONs" required on Linux MySQL (lower_case_table_names=0).

import { DataTypes } from "sequelize";

const PERMISSIONS_TO_SEED = [
  {
    code: "invoice:signature:request",
    module: "Invoices",
    description: "Request customer / operator signatures on bills",
  },
  {
    code: "invoice:signature:view",
    module: "Invoices",
    description: "View captured signatures and signature audit",
  },
  {
    code: "user:signature:manage_own",
    module: "Users",
    description: "Store and update own operator signature on profile",
  },
];

const columnExists = async (queryInterface, table, column) => {
  try {
    const desc = await queryInterface.describeTable(table);
    return !!desc?.[column];
  } catch {
    return false;
  }
};

const tableExists = async (queryInterface, table) => {
  try {
    await queryInterface.describeTable(table);
    return true;
  } catch {
    return false;
  }
};

export const up = async ({ context: queryInterface }) => {
  const sequelize = queryInterface.sequelize;

  // 1. SIGNATURE_REQUESTS — one row per capture session
  if (!(await tableExists(queryInterface, "SIGNATURE_REQUESTS"))) {
    await queryInterface.createTable("SIGNATURE_REQUESTS", {
      request_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      invoice_id: { type: DataTypes.INTEGER, allowNull: false },
      checkpoint: {
        type: DataTypes.ENUM(
          "DEPOSIT_COLLECTED",
          "EQUIPMENT_DISPATCHED",
          "EQUIPMENT_RETURNED",
          "PAYMENT_RECEIVED",
          "OTHER",
        ),
        allowNull: false,
        defaultValue: "OTHER",
      },
      required_roles: { type: DataTypes.JSON, allowNull: false },
      token: { type: DataTypes.STRING(80), allowNull: false, unique: true },
      requested_by_user_id: { type: DataTypes.INTEGER, allowNull: false },
      status: {
        type: DataTypes.ENUM(
          "PENDING",
          "PARTIAL",
          "COMPLETED",
          "EXPIRED",
          "CANCELLED",
        ),
        allowNull: false,
        defaultValue: "PENDING",
      },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });

    await queryInterface.addIndex("SIGNATURE_REQUESTS", ["invoice_id"]);
    await queryInterface.addIndex("SIGNATURE_REQUESTS", ["status"]);
    await queryInterface.addIndex("SIGNATURE_REQUESTS", ["expires_at"]);
  }

  // 2. INVOICE_SIGNATURES — one row per captured signature
  if (!(await tableExists(queryInterface, "INVOICE_SIGNATURES"))) {
    await queryInterface.createTable("INVOICE_SIGNATURES", {
      signature_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      invoice_id: { type: DataTypes.INTEGER, allowNull: false },
      signature_request_id: { type: DataTypes.INTEGER, allowNull: true },
      checkpoint: {
        type: DataTypes.ENUM(
          "DEPOSIT_COLLECTED",
          "EQUIPMENT_DISPATCHED",
          "EQUIPMENT_RETURNED",
          "PAYMENT_RECEIVED",
          "OTHER",
        ),
        allowNull: false,
        defaultValue: "OTHER",
      },
      signatory_role: {
        type: DataTypes.ENUM("CUSTOMER", "OPERATOR", "GUARANTOR", "WITNESS"),
        allowNull: false,
      },
      signatory_name: { type: DataTypes.STRING(150), allowNull: false },
      signatory_user_id: { type: DataTypes.INTEGER, allowNull: true },
      image_url: { type: DataTypes.STRING(500), allowNull: false },
      image_sha256: { type: DataTypes.STRING(64), allowNull: true },
      source: {
        type: DataTypes.ENUM(
          "PHONE_CANVAS",
          "POS_CANVAS",
          "STORED_OPERATOR_SIG",
        ),
        allowNull: false,
        defaultValue: "PHONE_CANVAS",
      },
      captured_from_ip: { type: DataTypes.STRING(45), allowNull: true },
      captured_from_user_agent: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      terms_version_signed: { type: DataTypes.INTEGER, allowNull: true },
      captured_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });

    await queryInterface.addIndex("INVOICE_SIGNATURES", ["invoice_id"]);
    await queryInterface.addIndex("INVOICE_SIGNATURES", ["signature_request_id"]);
    await queryInterface.addIndex("INVOICE_SIGNATURES", ["signatory_user_id"]);
    await queryInterface.addIndex("INVOICE_SIGNATURES", ["captured_at"]);
  }

  // 3. USERS.signature_url + signature_captured_at (operator saved signature)
  if (!(await columnExists(queryInterface, "USERS", "signature_url"))) {
    await queryInterface.addColumn("USERS", "signature_url", {
      type: DataTypes.STRING(500),
      allowNull: true,
    });
  }
  if (!(await columnExists(queryInterface, "USERS", "signature_captured_at"))) {
    await queryInterface.addColumn("USERS", "signature_captured_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
  }

  // 4. TENANT_CONFIG.rental_terms_markdown + rental_terms_version
  if (
    !(await columnExists(queryInterface, "TENANT_CONFIG", "rental_terms_markdown"))
  ) {
    await queryInterface.addColumn("TENANT_CONFIG", "rental_terms_markdown", {
      type: DataTypes.TEXT("long"),
      allowNull: true,
    });
  }
  if (
    !(await columnExists(queryInterface, "TENANT_CONFIG", "rental_terms_version"))
  ) {
    await queryInterface.addColumn("TENANT_CONFIG", "rental_terms_version", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    });
  }

  // 5. Seed permissions + grant to Admin/Owner roles
  try {
    for (const perm of PERMISSIONS_TO_SEED) {
      const [existing] = await sequelize.query(
        "SELECT permission_id FROM PERMISSIONS WHERE permission_code = :code LIMIT 1",
        { replacements: { code: perm.code } },
      );

      let permId = existing && existing[0]?.permission_id;
      if (!permId) {
        const [insertResult] = await sequelize.query(
          "INSERT INTO PERMISSIONS (permission_code, module_name, description) VALUES (:code, :module, :description)",
          { replacements: perm },
        );
        permId = insertResult;
      }

      if (permId) {
        const [adminRoles] = await sequelize.query(
          "SELECT role_id FROM ROLES WHERE hierarchy_level >= 50 OR LOWER(role_name) LIKE '%admin%' OR LOWER(role_name) LIKE '%owner%'",
        );
        for (const role of adminRoles) {
          const [hasRolePerm] = await sequelize.query(
            "SELECT * FROM `ROLE_PERMISSIONs` WHERE role_id = :roleId AND permission_id = :permId LIMIT 1",
            { replacements: { roleId: role.role_id, permId } },
          );
          if (!hasRolePerm || hasRolePerm.length === 0) {
            await sequelize.query(
              "INSERT INTO `ROLE_PERMISSIONs` (role_id, permission_id) VALUES (:roleId, :permId)",
              { replacements: { roleId: role.role_id, permId } },
            );
          }
        }
      }
    }
  } catch (err) {
    console.warn(
      "Permission seeding during signature migration had non-fatal notice:",
      err.message,
    );
  }
};

export const down = async ({ context: queryInterface }) => {
  // Drop in reverse dependency order. Leave permission rows in place — they
  // are cheap and dropping them would churn ROLE_PERMISSIONs for no benefit.
  await queryInterface.dropTable("INVOICE_SIGNATURES");
  await queryInterface.dropTable("SIGNATURE_REQUESTS");

  if (await columnExists(queryInterface, "USERS", "signature_captured_at")) {
    await queryInterface.removeColumn("USERS", "signature_captured_at");
  }
  if (await columnExists(queryInterface, "USERS", "signature_url")) {
    await queryInterface.removeColumn("USERS", "signature_url");
  }
  if (
    await columnExists(queryInterface, "TENANT_CONFIG", "rental_terms_version")
  ) {
    await queryInterface.removeColumn("TENANT_CONFIG", "rental_terms_version");
  }
  if (
    await columnExists(queryInterface, "TENANT_CONFIG", "rental_terms_markdown")
  ) {
    await queryInterface.removeColumn("TENANT_CONFIG", "rental_terms_markdown");
  }
};
