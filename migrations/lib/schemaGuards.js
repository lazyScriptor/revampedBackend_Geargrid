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
