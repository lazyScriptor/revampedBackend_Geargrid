// migrations/tenant/20261115120000-ensure-bulk-jobs-table.js
// Create BULK_JOBS where it is missing.
//
// Why: in production the bulk job worker logged "Table '<tenant>.BULK_JOBS' doesn't exist" for
// geargrid_t_a_enterprises_mv8kypdv and geargrid_senevirathna_enterprises_mw2fb24v, so CSV/XLSX
// imports and exports could not run for those shops. Their SequelizeMeta already lists
// 20260522000002-create-bulk-jobs.js (tenants are baselined on creation), so that migration never
// ran there, and the startup sequelize.sync() that used to fill such gaps stopped part-way on legacy
// zero dates before it reached BULK_JOBS. Startup sync is gone now, so migrations must close the gap.
//
// Safe to run any number of times: creates the table only if missing, adds each index only if missing.
// Matches src/models/BulkJob.js and 20260522000002-create-bulk-jobs.js (no FK on user_id, as there).
import { DataTypes } from "sequelize";
import { tableExists, addIndexIfMissing } from "../lib/schemaGuards.js";

const TABLE = "BULK_JOBS";

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) {
    await qi.createTable(TABLE, {
      job_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      operation: { type: DataTypes.STRING(60), allowNull: false },
      entity: { type: DataTypes.STRING(40), allowNull: true },
      mode: {
        type: DataTypes.ENUM("import", "export", "bulk_action", "preview"),
        allowNull: false,
        defaultValue: "export",
      },
      status: {
        type: DataTypes.ENUM("queued", "processing", "completed", "failed", "cancelled", "awaiting_confirmation"),
        allowNull: false,
        defaultValue: "queued",
      },
      progress: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
      total_count: { type: DataTypes.INTEGER, allowNull: true },
      processed_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      error_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      params: { type: DataTypes.JSON, allowNull: true },
      result_payload: { type: DataTypes.JSON, allowNull: true },
      error_message: { type: DataTypes.TEXT, allowNull: true },
      input_file_path: { type: DataTypes.STRING(500), allowNull: true },
      output_file_path: { type: DataTypes.STRING(500), allowNull: true },
      started_at: { type: DataTypes.DATE, allowNull: true },
      finished_at: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  }

  await addIndexIfMissing(qi, TABLE, ["status", "createdAt"]);
  await addIndexIfMissing(qi, TABLE, ["user_id", "createdAt"]);
  await addIndexIfMissing(qi, TABLE, ["entity", "mode", "createdAt"]);
};

// Nothing to undo: on most tenants the table predates this migration (20260522000002 owns it),
// so dropping it here would delete their job history.
export const down = async () => {};
