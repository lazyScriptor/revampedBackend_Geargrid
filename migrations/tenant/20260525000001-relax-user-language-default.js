// 20260525000001-relax-user-language-default.js
//
// USERS.language was created with NOT NULL DEFAULT "en", which meant every
// user row carried "en" forever — even users who had never visited the
// language preference screen. When a super admin sets the tenant default to
// Sinhala, those existing users keep seeing English because the auth flow
// resolves `user.language || tenant.default_language` and the legacy default
// "en" wins.
//
// This migration:
//   1. Relaxes the column to ALLOW NULL with no default so new accounts
//      genuinely have "no preference" and inherit the tenant default.
//   2. Sets every existing user's language to NULL. We can't distinguish
//      between "I deliberately chose English" and "the model put 'en' there
//      automatically", but on a fresh deployment the safer default is NULL
//      so the tenant choice (typically Sinhala on GearGrid) takes effect.
//      Users who want to keep English can switch via the AppBar menu — it
//      only takes one click and persists.

import { DataTypes } from "sequelize";

export const up = async ({ context: queryInterface }) => {
  const cols = await queryInterface.describeTable("USERS");
  if (!cols.language) {
    // Column doesn't exist — nothing to relax. The current model factory
    // already creates the column as NULL-able, so we're done.
    return;
  }

  await queryInterface.changeColumn("USERS", "language", {
    type: DataTypes.STRING(10),
    allowNull: true,
    defaultValue: null,
  });

  // Reset legacy auto-defaulted values back to NULL so the tenant default
  // language kicks in for these users on their next login.
  await queryInterface.sequelize.query("UPDATE USERS SET language = NULL WHERE language = 'en'");
};

export const down = async ({ context: queryInterface }) => {
  // Restore the old NOT NULL DEFAULT 'en' contract. We fill nulls first so
  // the constraint doesn't error.
  await queryInterface.sequelize.query("UPDATE USERS SET language = 'en' WHERE language IS NULL");
  await queryInterface.changeColumn("USERS", "language", {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: "en",
  });
};
