import { DataTypes } from "sequelize";

export const up = async ({ context: queryInterface }) => {
  await queryInterface.createTable("BULK_JOBS", {
    job_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    operation: { type: DataTypes.STRING(60), allowNull: false },
    entity: { type: DataTypes.STRING(40), allowNull: true },
    mode: {
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
        "awaiting_confirmation",
      ),
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

  await queryInterface.addIndex("BULK_JOBS", ["status", "createdAt"]);
  await queryInterface.addIndex("BULK_JOBS", ["user_id", "createdAt"]);
  await queryInterface.addIndex("BULK_JOBS", ["entity", "mode", "createdAt"]);
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.dropTable("BULK_JOBS");
};
