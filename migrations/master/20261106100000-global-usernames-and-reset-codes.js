// Log in with a username: usernames move into the login directory, unique across all shops. Until now
// they were only unique within a shop, so a name used by two shops is left out here: those people keep
// logging in by email until one of them changes it. Safe to run twice.
import { DataTypes } from "sequelize";

export const up = async ({ context: queryInterface }) => {
  const sequelize = queryInterface.sequelize;
  const globalUsers = await queryInterface.describeTable("GLOBAL_USERS");
  if (!globalUsers.username) {
    await queryInterface.addColumn("GLOBAL_USERS", "username", { type: DataTypes.STRING(100), allowNull: true });
  }

  const tables = await queryInterface.showAllTables();
  if (!tables.map(String).includes("PASSWORD_RESET_CODES")) {
    await queryInterface.createTable("PASSWORD_RESET_CODES", {
      code_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      global_user_id: { type: DataTypes.INTEGER, allowNull: false },
      code_hash: { type: DataTypes.STRING(64), allowNull: false },
      channel: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "email" },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      used_at: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex("PASSWORD_RESET_CODES", ["global_user_id"]);
  }

  // Copy usernames across. One unreadable shop must not stop the rest: its people keep using email.
  const [tenants] = await sequelize.query("SELECT db_name FROM TENANTS");
  const seen = new Map();
  for (const { db_name } of tenants) {
    try {
      const [users] = await sequelize.query(`SELECT email, username FROM \`${db_name.replace(/`/g, "")}\`.USERS`);
      for (const u of users) {
        if (!u.username || !u.email || u.username.includes("@")) continue;
        const key = u.username.trim().toLowerCase();
        const list = seen.get(key) ?? [];
        list.push({ email: u.email, username: u.username.trim() });
        seen.set(key, list);
      }
    } catch (err) {
      console.warn(`usernames: skipped ${db_name}: ${err.message}`);
    }
  }
  for (const list of seen.values()) {
    if (list.length !== 1) continue;
    await sequelize.query("UPDATE GLOBAL_USERS SET username = :username WHERE email = :email AND username IS NULL", { replacements: list[0] });
  }

  const indexes = await queryInterface.showIndex("GLOBAL_USERS");
  if (!indexes.some((i) => i.name === "global_users_username_unique")) {
    await queryInterface.addIndex("GLOBAL_USERS", ["username"], { unique: true, name: "global_users_username_unique" });
  }
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.dropTable("PASSWORD_RESET_CODES").catch(() => {});
  await queryInterface.removeIndex("GLOBAL_USERS", "global_users_username_unique").catch(() => {});
  const globalUsers = await queryInterface.describeTable("GLOBAL_USERS");
  if (globalUsers.username) await queryInterface.removeColumn("GLOBAL_USERS", "username");
};
