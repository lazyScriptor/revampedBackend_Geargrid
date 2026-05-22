import { DataTypes } from "sequelize";

const TABLE = "NOTIFICATIONS";

const tableExists = async (qi) => {
  try {
    const desc = await qi.describeTable(TABLE);
    return !!desc && Object.keys(desc).length > 0;
  } catch {
    return false;
  }
};

const safeAddIndex = async (qi, fields) => {
  try {
    await qi.addIndex(TABLE, fields);
  } catch (err) {
    // Sequelize sync may have already created the index — ignore "Duplicate key"
    // and "index already exists" errors so re-runs stay idempotent.
    const msg = String(err?.message || err);
    if (msg.includes("Duplicate") || msg.includes("already exists")) return;
    throw err;
  }
};

export const up = async ({ context: queryInterface }) => {
  if (!(await tableExists(queryInterface))) {
    await queryInterface.createTable(TABLE, {
      notification_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      type: {
        type: DataTypes.ENUM(
          "bulk_job",
          "info",
          "success",
          "warning",
          "error",
          "system",
        ),
        allowNull: false,
        defaultValue: "info",
      },
      category: { type: DataTypes.STRING(40), allowNull: true },
      title: { type: DataTypes.STRING(160), allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: true },
      payload: { type: DataTypes.JSON, allowNull: true },
      link: { type: DataTypes.STRING(255), allowNull: true },
      read_at: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  }

  await safeAddIndex(queryInterface, ["user_id", "createdAt"]);
  await safeAddIndex(queryInterface, ["user_id", "read_at"]);
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.dropTable(TABLE);
};
