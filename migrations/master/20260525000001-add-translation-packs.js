// 20260525000001-add-translation-packs.js
// Creates TRANSLATION_PACKS in the master DB and adds default_language to TENANTS.
// Idempotent — checks for existing tables/columns first so re-running is safe
// (server-boot sync() may have already created the table from the model).

import { DataTypes } from "sequelize";

export const up = async ({ context: queryInterface }) => {
  // 1. TRANSLATION_PACKS table
  const tables = await queryInterface.showAllTables();
  const tableNames = tables.map((t) =>
    typeof t === "string" ? t : t.tableName,
  );
  if (!tableNames.includes("TRANSLATION_PACKS")) {
    await queryInterface.createTable("TRANSLATION_PACKS", {
      pack_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      language_code: { type: DataTypes.STRING(10), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(50), allowNull: false },
      native_name: { type: DataTypes.STRING(50), allowNull: false },
      translations: { type: DataTypes.JSON, allowNull: false },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    try {
      await queryInterface.addIndex("TRANSLATION_PACKS", ["language_code"], {
        unique: true,
        name: "ux_translation_packs_lang",
      });
    } catch (e) {
      if (!/Duplicate|already exists/i.test(e?.message || "")) throw e;
    }
  }

  // 2. TENANTS.default_language column
  const tenantCols = await queryInterface.describeTable("TENANTS");
  if (!tenantCols.default_language) {
    await queryInterface.addColumn("TENANTS", "default_language", {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: "si",
    });
  }
};

export const down = async ({ context: queryInterface }) => {
  // Reverse order
  const tenantCols = await queryInterface.describeTable("TENANTS").catch(() => ({}));
  if (tenantCols.default_language) {
    await queryInterface.removeColumn("TENANTS", "default_language");
  }
  await queryInterface.dropTable("TRANSLATION_PACKS").catch(() => {});
};
