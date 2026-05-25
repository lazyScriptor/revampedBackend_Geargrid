import { DataTypes } from "sequelize";

export default (sequelize) => {
  const User = sequelize.define(
    "User",
    {
      user_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      warehouse_id: { type: DataTypes.INTEGER, allowNull: true },
      username: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      password_hash: { type: DataTypes.STRING(255), allowNull: false },
      first_name: { type: DataTypes.STRING(100), allowNull: false },
      last_name: { type: DataTypes.STRING(100), allowNull: false },
      nic_no: { type: DataTypes.STRING(20), allowNull: false, unique: true },
      phone_number: { type: DataTypes.STRING(50), allowNull: true },
      address_line1: { type: DataTypes.STRING(255), allowNull: true },
      address_line2: { type: DataTypes.STRING(255), allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
      // ── Profile + preferences (self-serve) ───────────────────────────────
      avatar_url: { type: DataTypes.STRING(500), allowNull: true },
      job_title: { type: DataTypes.STRING(120), allowNull: true },
      bio: { type: DataTypes.TEXT, allowNull: true },
      // No default — left NULL so the auth resolver falls through to
      // tenant.default_language. A non-null value means the user explicitly
      // chose this language on their profile and overrides the tenant default.
      language: { type: DataTypes.STRING(10), allowNull: true },
      timezone: { type: DataTypes.STRING(50), allowNull: true },
      date_format: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "YYYY-MM-DD" },
      time_format: { type: DataTypes.ENUM("12h", "24h"), allowNull: false, defaultValue: "24h" },
      notification_prefs: { type: DataTypes.JSON, allowNull: true },
      last_login_at: { type: DataTypes.DATE, allowNull: true },
      last_login_ip: { type: DataTypes.STRING(45), allowNull: true },
      password_changed_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "USERS",
      timestamps: true, // Critical: Matches your SQL dump
    },
  );
  return User;
};
