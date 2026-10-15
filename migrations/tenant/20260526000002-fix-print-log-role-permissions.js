// migrations/tenant/20260526000002-fix-print-log-role-permissions.js
// Robustly seeds 'invoice:print_log:view' and binds it to Admin/Manager roles,
// handling Linux case-sensitive MySQL table naming (ROLE_PERMISSIONs vs role_permissions vs ROLE_PERMISSIONS).

export const up = async ({ context: queryInterface }) => {
  const sequelize = queryInterface.sequelize;

  // 1. Discover actual table names in current tenant database
  const [tables] = await sequelize.query("SHOW TABLES");
  const tableNames = tables.map((t) => Object.values(t)[0]);

  const permTableName = tableNames.find((t) => t.toLowerCase() === "permissions") || "permissions";
  const rolePermTableName =
    tableNames.find(
      (t) =>
        t.toLowerCase() === "role_permissions" ||
        t.toLowerCase() === "role_permissions" ||
        t === "ROLE_PERMISSIONs"
    ) || "role_permissions";
  const rolesTableName = tableNames.find((t) => t.toLowerCase() === "roles") || "roles";

  // 2. Ensure 'invoice:print_log:view' exists in permissions table
  const [existingPerms] = await sequelize.query(
    `SELECT permission_id FROM \`${permTableName}\` WHERE permission_code = 'invoice:print_log:view' LIMIT 1`
  );

  let permId = existingPerms && existingPerms[0]?.permission_id;
  if (!permId) {
    const [insertResult] = await sequelize.query(
      `INSERT INTO \`${permTableName}\` (permission_code, module_name, description) VALUES ('invoice:print_log:view', 'Invoices', 'View POS bill printing audit logs')`
    );
    permId = insertResult;
  }

  // 3. Grant to Admin & Manager roles
  if (permId && rolePermTableName && rolesTableName) {
    const [targetRoles] = await sequelize.query(
      `SELECT role_id FROM \`${rolesTableName}\` WHERE hierarchy_level >= 50 OR LOWER(role_name) LIKE '%admin%' OR LOWER(role_name) LIKE '%owner%'`
    );

    for (const r of targetRoles) {
      const [assigned] = await sequelize.query(
        `SELECT * FROM \`${rolePermTableName}\` WHERE role_id = ${r.role_id} AND permission_id = ${permId} LIMIT 1`
      );
      if (!assigned || assigned.length === 0) {
        await sequelize.query(
          `INSERT INTO \`${rolePermTableName}\` (role_id, permission_id) VALUES (${r.role_id}, ${permId})`
        );
      }
    }
  }
};

export const down = async () => {
  // No-op rollback
};
