// Find and drop the numbered index copies that `sequelize.sync({ alter: true })` used to pile up.
//
// Every alter-sync re-added each `unique: true` column's key under the next free name: `email`, then
// `email_2`, `email_3`, … until MySQL refused with "Too many keys specified; max 64 keys allowed".
// The copies are byte-for-byte the same index, so dropping them changes nothing except freeing key
// slots and write overhead.
//
// Rule (deliberately narrow): an index named `<base>_<n>` is dropped only when the same table has
// another index named `<base>` (or `<base>_<m>` with m < n) that is EXACTLY the same index: same
// columns in the same order, same prefix lengths, same uniqueness, same index type. So
//   • PRIMARY is never touched;
//   • the base (or lowest-numbered) copy of every family is always kept, so foreign keys and unique
//     constraints keep an index behind them;
//   • an index whose columns or uniqueness differ is never dropped, whatever its name.
// Other kinds of overlap (e.g. `uq_x_name` next to `name`) are left alone on purpose.
// (Lives outside migrations/tenant/ because every file there is run.)

const NUMBERED = /^(.+)_(\d+)$/;

/** One row per (table, index, column) from information_schema.STATISTICS, current database. */
export const loadIndexColumns = async (sequelize) =>
  sequelize.query(
    `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, NON_UNIQUE AS non_unique,
            SEQ_IN_INDEX AS seq, COLUMN_NAME AS column_name, SUB_PART AS sub_part, INDEX_TYPE AS index_type
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    { type: "SELECT" },
  );

/**
 * Pure planner: given STATISTICS rows, return the duplicate indexes to drop.
 * @returns {{ table: string, index: string, keep: string }[]} sorted by table, then index number
 */
export const planDuplicateIndexDrops = (rows) => {
  // table -> index -> { nonUnique, type, cols: [[seq, col, sub]] }
  const tables = new Map();
  for (const r of rows) {
    if (!tables.has(r.table_name)) tables.set(r.table_name, new Map());
    const idx = tables.get(r.table_name);
    if (!idx.has(r.index_name)) {
      idx.set(r.index_name, { nonUnique: Number(r.non_unique), type: r.index_type, cols: [] });
    }
    idx.get(r.index_name).cols.push([Number(r.seq), r.column_name, r.sub_part == null ? "" : String(r.sub_part)]);
  }

  const drops = [];
  for (const [table, indexes] of tables) {
    const signature = new Map();
    for (const [name, ix] of indexes) {
      const cols = ix.cols.sort((a, b) => a[0] - b[0]).map(([, c, s]) => (s ? `${c}(${s})` : c));
      signature.set(name, `${ix.nonUnique}|${ix.type}|${cols.join(",")}`);
    }

    // Number of a name within its base family: `<base>` is 1 (sync's first copy), `<base>_<n>` is n.
    const rank = (name, base) => {
      if (name === base) return 1;
      const m = NUMBERED.exec(name);
      return m && m[1] === base ? Number(m[2]) : null;
    };

    for (const [name, sig] of signature) {
      if (name === "PRIMARY") continue;
      const m = NUMBERED.exec(name);
      if (!m) continue;
      const [, base, num] = m;
      const n = Number(num);
      // The lowest-ranked identical sibling in the same family is what we keep.
      let keep = null;
      let keepRank = n;
      for (const [other, otherSig] of signature) {
        if (other === name || other === "PRIMARY" || otherSig !== sig) continue;
        const r = rank(other, base);
        if (r != null && r < keepRank) {
          keep = other;
          keepRank = r;
        }
      }
      if (keep) drops.push({ table, index: name, keep, n });
    }
  }

  drops.sort((a, b) => (a.table === b.table ? a.n - b.n : a.table < b.table ? -1 : 1));
  return drops.map(({ table, index, keep }) => ({ table, index, keep }));
};

/**
 * Drop every duplicate found by planDuplicateIndexDrops on the query interface's database.
 * Safe to run again: a second run finds nothing to drop. An index MySQL refuses to drop because a
 * foreign key needs it (ER_DROP_INDEX_FK, 1553) is skipped and logged, never forced.
 * @returns {Promise<{ dropped: object[], skipped: object[] }>}
 */
export const dropDuplicateIndexes = async (qi, { log = console.log } = {}) => {
  const rows = await loadIndexColumns(qi.sequelize);
  const plan = planDuplicateIndexDrops(rows);
  const dropped = [];
  const skipped = [];
  for (const d of plan) {
    try {
      await qi.removeIndex(d.table, d.index);
      dropped.push(d);
    } catch (err) {
      const code = err?.original?.errno ?? err?.parent?.errno ?? err?.errno;
      if (code !== 1553) throw err;
      skipped.push({ ...d, reason: err.message });
      log(`  ! kept ${d.table}.${d.index}: ${err.message}`);
    }
  }

  const perTable = {};
  for (const d of dropped) perTable[d.table] = (perTable[d.table] || 0) + 1;
  for (const [table, count] of Object.entries(perTable)) {
    const kept = [...new Set(dropped.filter((d) => d.table === table).map((d) => d.keep))];
    log(`  dropped ${count} duplicate index(es) on ${table} (kept ${kept.join(", ")})`);
  }
  if (!dropped.length && !skipped.length) log("  no duplicate indexes found");
  return { dropped, skipped };
};
