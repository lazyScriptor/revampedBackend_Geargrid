import { DataTypes } from "sequelize";

/**
 * TranslationPack — platform-wide i18n storage.
 *
 * One row per language. Translations are stored as a nested JSON blob so we
 * can ship full namespaces (nav, dashboard, forms, errors…) in a single DB
 * round-trip. The `version` column is bumped on every update so the frontend
 * cache can invalidate cleanly.
 *
 * The frontend ships a baseline JSON locale for `en` and `si` so the app boots
 * even when the API is offline; the DB pack overrides on top once fetched.
 */
export default (sequelize) => {
  const TranslationPack = sequelize.define(
    "TranslationPack",
    {
      pack_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      // ISO 639-1 (e.g. "en", "si"). Unique so we can upsert by code.
      language_code: {
        type: DataTypes.STRING(10),
        allowNull: false,
        unique: true,
      },
      // English display label, e.g. "English", "Sinhala"
      name: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      // Native-script label, e.g. "English", "සිංහල"
      native_name: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      // Full translation tree keyed by namespace, e.g.
      //   { common: { save: "Save", cancel: "Cancel" }, nav: { dashboard: ... } }
      translations: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
      },
      // Monotonically increasing integer. Bumped on every write. The frontend
      // includes ?v=<version> when fetching the pack so CDN/browser caches can
      // safely cache aggressively.
      version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      // Languages can be hidden from end users while still draftable by the
      // super admin (e.g. Tamil in progress, English only for staff, etc.).
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: "TRANSLATION_PACKS",
      timestamps: true,
      indexes: [{ unique: true, fields: ["language_code"] }],
    },
  );
  return TranslationPack;
};
