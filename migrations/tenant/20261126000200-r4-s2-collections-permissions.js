const MODULE = "Phone Assistant";
const PERMS = [["calls:listen", "Listen to call recordings"]];

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
  const sequelize = qi.sequelize;
  const { permTable, rolePermTable, rolesTable } = await resolveTables(sequelize);

  const permIds = {};
  for (const [code, description] of PERMS) {
    const [found] = await sequelize.query(
      `SELECT permission_id FROM \`${permTable}\` WHERE permission_code = ? LIMIT 1`,
      { replacements: [code] },
    );
    if (found[0]) {
      permIds[code] = found[0].permission_id;
    } else {
      const [insertId] = await sequelize.query(
        `INSERT INTO \`${permTable}\` (permission_code, module_name, description) VALUES (?, ?, ?)`,
        { replacements: [code, MODULE, description] },
      );
      permIds[code] = insertId;
    }
  }

  const grant = async (roleId, permId) => {
    const [has] = await sequelize.query(
      `SELECT 1 FROM \`${rolePermTable}\` WHERE role_id = ? AND permission_id = ? LIMIT 1`,
      { replacements: [roleId, permId] },
    );
    if (!has[0]) {
      await sequelize.query(
        `INSERT INTO \`${rolePermTable}\` (role_id, permission_id) VALUES (?, ?)`,
        { replacements: [roleId, permId] },
      );
    }
  };

  // Grant only to Administrator roles (hierarchy_level >= 100).
  const [admins] = await sequelize.query(
    `SELECT role_id FROM \`${rolesTable}\` WHERE hierarchy_level >= 100`,
  );
  for (const r of admins) {
    for (const permId of Object.values(permIds)) {
      await grant(r.role_id, permId);
    }
  }
};

export const down = async ({ context: qi }) => {
  const sequelize = qi.sequelize;
  const { permTable, rolePermTable } = await resolveTables(sequelize);
  for (const [code] of PERMS) {
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
};
