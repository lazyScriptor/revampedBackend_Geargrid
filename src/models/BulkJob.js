import { DataTypes } from "sequelize";

export default (sequelize) => {
  const BulkJob = sequelize.define(
    "BulkJob",
    {
      job_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      operation: {
        // e.g. "import_equipment", "export_customers_excel",
        // "export_profit_loss_pdf", "bulk_delete_equipment"
        type: DataTypes.STRING(60),
        allowNull: false,
      },
      entity: {
        // High-level grouping for UI: equipment | customers | invoices |
        // payments | expenses | reports | reviews
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      mode: {
        // import | export | bulk_action | preview
        type: DataTypes.ENUM("import", "export", "bulk_action", "preview"),
        allowNull: false,
        defaultValue: "export",
      },
      status: {
        type: DataTypes.ENUM(
          "queued",
          "processing",
          "completed",
          "failed",
          "cancelled",
          "awaiting_confirmation", // for dry-run previews waiting on user OK
        ),
        allowNull: false,
        defaultValue: "queued",
      },
      progress: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 0, // 0-100
      },
      total_count: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      processed_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      error_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      params: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      result_payload: {
        // { download_url, file_size_bytes, errors_sample: [], summary: {...} }
        type: DataTypes.JSON,
        allowNull: true,
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      input_file_path: {
        // Server-relative path to uploaded input file (imports)
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      output_file_path: {
        // Server-relative path to generated output file (exports / dry-run reports)
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      started_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      finished_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "BULK_JOBS",
      timestamps: true,
      indexes: [
        { fields: ["status", "createdAt"] },
        { fields: ["user_id", "createdAt"] },
        { fields: ["entity", "mode", "createdAt"] },
      ],
    },
  );

  return BulkJob;
};
