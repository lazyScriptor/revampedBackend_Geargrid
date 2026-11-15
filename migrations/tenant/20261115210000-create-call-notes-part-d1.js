import { DataTypes, literal } from "sequelize";
import { addIndexIfMissing, tableExists } from "../lib/schemaGuards.js";

const TABLE = "CALL_NOTES";

const resolveTables = async (sequelize) => {
  const [tables] = await sequelize.query("SHOW TABLES");
  const names = tables.map((t) => Object.values(t)[0]);
  return {
    permTable: names.find((t) => t.toLowerCase() === "permissions") || "permissions",
    rolePermTable:
      names.find((t) => t === "ROLE_PERMISSIONs" || t.toLowerCase() === "role_permissions") ||
      "ROLE_PERMISSIONs",
    rolesTable: names.find((t) => t.toLowerCase() === "roles") || "roles",
  };
};

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) {
    await qi.createTable(
      TABLE,
      {
        note_id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        call_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        customer_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        contact_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        tags: {
          type: DataTypes.JSON,
          allowNull: false,
        },
        note: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        follow_up_on: {
          type: DataTypes.DATEONLY,
          allowNull: true,
        },
        follow_up_done_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        created_by_user_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal("CURRENT_TIMESTAMP"),
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        },
      },
      { charset: "utf8mb4", collate: "utf8mb4_unicode_ci" },
    );
  }

  await addIndexIfMissing(qi, TABLE, ["call_id"], {
    name: "idx_call_notes_call_id",
  });
  await addIndexIfMissing(qi, TABLE, ["customer_id"], {
    name: "idx_call_notes_customer_id",
  });
  await addIndexIfMissing(qi, TABLE, ["follow_up_on"], {
    name: "idx_call_notes_follow_up_on",
  });

  // Ensure call_notes:write exists and is granted to admin roles and roles with calls:view.
  const sequelize = qi.sequelize;
  const { permTable, rolePermTable, rolesTable } = await resolveTables(sequelize);

  let callNotesPermId = null;
  const [found] = await sequelize.query(
    `SELECT permission_id FROM \`${permTable}\` WHERE permission_code = ? LIMIT 1`,
    { replacements: ["call_notes:write"] },
  );
  if (found[0]) {
    callNotesPermId = found[0].permission_id;
  } else {
    const [insertId] = await sequelize.query(
      `INSERT INTO \`${permTable}\` (permission_code, module_name, description) VALUES (?, ?, ?)`,
      {
        replacements: [
          "call_notes:write",
          "calls",
          "Create and update call notes and follow-ups",
        ],
      },
    );
    callNotesPermId = insertId;
  }

  if (callNotesPermId) {
    const [eligibleRoles] = await sequelize.query(
      `SELECT DISTINCT r.role_id
       FROM \`${rolesTable}\` r
       LEFT JOIN \`${rolePermTable}\` rp ON rp.role_id = r.role_id
       LEFT JOIN \`${permTable}\` p ON p.permission_id = rp.permission_id
       WHERE r.hierarchy_level >= 100 OR p.permission_code = 'calls:view'`,
    );
    for (const r of eligibleRoles) {
      const [has] = await sequelize.query(
        `SELECT 1 FROM \`${rolePermTable}\` WHERE role_id = ? AND permission_id = ? LIMIT 1`,
        { replacements: [r.role_id, callNotesPermId] },
      );
      if (!has[0]) {
        await sequelize.query(
          `INSERT INTO \`${rolePermTable}\` (role_id, permission_id) VALUES (?, ?)`,
          { replacements: [r.role_id, callNotesPermId] },
        );
      }
    }
  }
};

export const down = async ({ context: qi }) => {
  if (await tableExists(qi, TABLE)) {
    await qi.dropTable(TABLE);
  }
};
