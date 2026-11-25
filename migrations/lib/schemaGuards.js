// Helpers that make a migration safe to run on a database that already has (part of) its change.
//
// Why this exists: tenants are tracked by a SequelizeMeta table. A tenant whose tracking rows are
// missing (never baselined, baseline failed, restored from a backup, …) replays migrations from the
// very first one, against a schema that already contains their columns/tables/indexes. A plain
// addColumn/addIndex then throws "Duplicate column/key", the runner stops that tenant at the first
// such migration, and every newer migration silently never runs there. Migrations must therefore
// tolerate "already done". (Lives outside migrations/tenant/ because every file there is run.)

export const tableExists = async (qi, table) => {
  const tables = await qi.showAllTables();
  return tables.map((t) => (typeof t === "string" ? t : Object.values(t)[0])).includes(table);
};

export const hasColumn = async (qi, table, column) => {
  const cols = await qi.describeTable(table);
  return Object.prototype.hasOwnProperty.call(cols, column);
};

export const addColumnIfMissing = async (qi, table, column, definition) => {
  if (await hasColumn(qi, table, column)) return false;
  await qi.addColumn(table, column, definition);
  return true;
};

/** True if some index on `table` already covers exactly these columns, in this order (any name). */
export const hasIndexOn = async (qi, table, columns) => {
  const wanted = columns.join(",");
  const indexes = await qi.showIndex(table);
  return indexes.some((ix) => (ix.fields || []).map((f) => f.attribute).join(",") === wanted);
};

export const addIndexIfMissing = async (qi, table, columns, options = {}) => {
  if (await hasIndexOn(qi, table, columns)) return false;
  await qi.addIndex(table, columns, options);
  return true;
};

/**
 * Replace invalid "zero dates" (0000-00-00 [00:00:00]) in every date/datetime/timestamp column of `table`
 * (NULL where the column allows it, otherwise the current time). Legacy rows written while MySQL's date
 * checks were off keep such values; they are harmless until a migration makes MySQL copy the table
 * (changeColumn, …), when strict mode rejects them: "Incorrect datetime value: '0000-00-00 00:00:00'".
 * Runs on ONE connection (a transaction) so the relaxed sql_mode applies to exactly these statements,
 * and puts the previous sql_mode back afterwards (pooled connections are reused).
 * @returns {Promise<number>} how many cells were repaired
 */
export const repairZeroDates = async (qi, table) => {
  const sequelize = qi.sequelize;
  const cols = await sequelize.query(
    "SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND DATA_TYPE IN ('date', 'datetime', 'timestamp')",
    { replacements: [table], type: "SELECT" },
  );
  if (!cols.length) return 0;

  let repaired = 0;
  await sequelize.transaction(async (t) => {
    const [{ mode }] = await sequelize.query("SELECT @@SESSION.sql_mode AS mode", { type: "SELECT", transaction: t });
    await sequelize.query("SET SESSION sql_mode = REPLACE(REPLACE(@@SESSION.sql_mode, 'NO_ZERO_DATE', ''), 'NO_ZERO_IN_DATE', '')", { transaction: t });
    try {
      for (const col of cols) {
        const where = `CAST(\`${col.name}\` AS CHAR) LIKE '0000-00-00%'`;
        const [{ n }] = await sequelize.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, { type: "SELECT", transaction: t });
        if (!Number(n)) continue;
        await sequelize.query(`UPDATE \`${table}\` SET \`${col.name}\` = ${col.nullable === "YES" ? "NULL" : "CURRENT_TIMESTAMP"} WHERE ${where}`, { transaction: t });
        repaired += Number(n);
      }
    } finally {
      await sequelize.query("SET SESSION sql_mode = ?", { replacements: [mode], transaction: t });
    }
  });
  return repaired;
};

/**
 * Make sure an ENUM column accepts every value in `values`. Reads the column's current type first and
 * only ALTERs when a value is missing; existing values keep their order, the new ones are added at the
 * end, and NULL-ability and default are kept as they are. Returns the values it added.
 */
export const ensureEnumValues = async (qi, table, column, values) => {
  const sequelize = qi.sequelize;
  const [col] = await sequelize.query(
    "SELECT COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column], type: "SELECT" },
  );
  if (!col) return [];
  const current = parseEnumValues(col.columnType);
  if (!current) return [];
  const missing = values.filter((v) => !current.includes(v));
  if (!missing.length) return [];
  const all = [...current, ...missing];
  const list = all.map((v) => sequelize.escape(v)).join(",");
  const nullable = String(col.nullable).toUpperCase() === "YES";
  // MySQL gives the default bare (DISPATCH); MariaDB gives it quoted ('DISPATCH') and says NULL for none.
  const rawDefault = col.dflt === "NULL" ? null : typeof col.dflt === "string" ? col.dflt.replace(/^'(.*)'$/s, "$1").replace(/''/g, "'") : col.dflt;
  col.dflt = rawDefault;
  const dflt = col.dflt === null || col.dflt === undefined ? (nullable ? " DEFAULT NULL" : "") : ` DEFAULT ${sequelize.escape(col.dflt)}`;
  await sequelize.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ENUM(${list}) ${nullable ? "NULL" : "NOT NULL"}${dflt}`);
  return missing;
};

/** "enum('A','B')" -> ["A","B"]; null when it is not an enum column type. */
export const parseEnumValues = (columnType) => {
  const m = /^enum\((.*)\)$/i.exec(String(columnType || "").trim());
  if (!m) return null;
  return [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
};
