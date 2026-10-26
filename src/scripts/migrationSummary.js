// Exit codes of `npm run db:migrate`, so the deploy can tell the cases apart:
//   0  everything migrated
//   1  the runner itself crashed (e.g. the master DB migration failed) — do NOT restart the server
//   3  master fine, but one or more tenant databases failed — restart is still right for the tenants
//      that did migrate, but the deploy must be marked failed so somebody looks
export const EXIT_OK = 0;
export const EXIT_CRASHED = 1;
export const EXIT_TENANT_FAILURES = 3;

/** A readable block for the deploy log. `failures` = [{ db_name, message }]. */
export const formatFailureSummary = (failures) => {
  if (!failures.length) return "";
  const lines = [
    "",
    "════════════════════════════════════════════════════════════════",
    `⚠️  ${failures.length} tenant database(s) FAILED to migrate.`,
    "    Until fixed, those tenants run new code against an old schema",
    "    (pages error with \"Unknown column …\"). Details:",
    ...failures.map((f) => `    • ${f.db_name}: ${f.message}`),
    "════════════════════════════════════════════════════════════════",
  ];
  return lines.join("\n");
};

export const exitCodeFor = (failures) => (failures.length ? EXIT_TENANT_FAILURES : EXIT_OK);
