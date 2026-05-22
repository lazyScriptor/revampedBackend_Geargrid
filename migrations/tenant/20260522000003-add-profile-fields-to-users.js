import { DataTypes } from "sequelize";

// Adds self-serve profile + preference + last-login columns to USERS.
// Up creates them all in one go; down drops them in reverse order.

const COLUMNS = [
  ["avatar_url", { type: DataTypes.STRING(500), allowNull: true }],
  ["job_title", { type: DataTypes.STRING(120), allowNull: true }],
  ["bio", { type: DataTypes.TEXT, allowNull: true }],
  ["language", { type: DataTypes.STRING(10), allowNull: false, defaultValue: "en" }],
  ["timezone", { type: DataTypes.STRING(50), allowNull: true }],
  ["date_format", { type: DataTypes.STRING(20), allowNull: false, defaultValue: "YYYY-MM-DD" }],
  ["time_format", { type: DataTypes.ENUM("12h", "24h"), allowNull: false, defaultValue: "24h" }],
  ["notification_prefs", { type: DataTypes.JSON, allowNull: true }],
  ["last_login_at", { type: DataTypes.DATE, allowNull: true }],
  ["last_login_ip", { type: DataTypes.STRING(45), allowNull: true }],
  ["password_changed_at", { type: DataTypes.DATE, allowNull: true }],
];

export const up = async ({ context: queryInterface }) => {
  // Read the existing column list once so we can skip columns that already
  // exist (lets re-runs after partial failure stay idempotent).
  const desc = await queryInterface.describeTable("USERS");
  for (const [name, spec] of COLUMNS) {
    if (!desc[name]) {
      await queryInterface.addColumn("USERS", name, spec);
    }
  }
};

export const down = async ({ context: queryInterface }) => {
  // Drop in reverse so any dependent indexes are removed first.
  for (let i = COLUMNS.length - 1; i >= 0; i--) {
    const [name] = COLUMNS[i];
    try {
      await queryInterface.removeColumn("USERS", name);
    } catch {
      // ignore — column may not exist
    }
  }
};
