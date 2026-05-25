// i18nService.js
//
// Platform-wide translation packs. Single source of truth lives in
// TRANSLATION_PACKS (master DB). The frontend ships baseline JSON locale
// files so the app boots offline and falls back gracefully if the API is
// slow; everything DB-backed merges on top once fetched.
//
// We deliberately keep this thin — translations are just JSON. No per-tenant
// overrides yet (super-admin manages packs centrally). When that's needed
// later, layer it in via a TENANT_TRANSLATION_OVERRIDES table that merges on
// top of the active pack at read time.

import { getMasterModels } from "../models/master/index.js";

const FALLBACK_PACKS = {
  en: { name: "English", native_name: "English" },
  si: { name: "Sinhala", native_name: "සිංහල" },
};

// Returns metadata for every active language. The frontend calls this once
// on app boot to populate its language switcher.
export const listManifest = async () => {
  const { TranslationPack } = getMasterModels();
  const packs = await TranslationPack.findAll({
    attributes: ["language_code", "name", "native_name", "version", "is_active"],
    where: { is_active: true },
    order: [["language_code", "ASC"]],
  });
  return packs.map((p) => p.toJSON());
};

// Returns the full pack for a given language. The router uses ETag/version
// query params so the browser can cache aggressively.
export const getPack = async (languageCode) => {
  const { TranslationPack } = getMasterModels();
  const pack = await TranslationPack.findOne({
    where: { language_code: languageCode },
  });
  if (!pack) {
    const meta = FALLBACK_PACKS[languageCode];
    if (!meta) return null;
    return {
      language_code: languageCode,
      ...meta,
      version: 0,
      translations: {},
    };
  }
  return pack.toJSON();
};

// Super-admin: upsert a pack (replaces or merges translations).
//
// mode = "replace" overwrites the entire pack body. mode = "merge" deep-merges
// the supplied tree on top of the existing translations — useful for tweaking
// a single namespace without re-uploading the whole file.
export const upsertPack = async ({
  language_code,
  name,
  native_name,
  translations,
  is_active,
  mode = "replace",
}) => {
  const { TranslationPack } = getMasterModels();
  const existing = await TranslationPack.findOne({ where: { language_code } });

  if (!existing) {
    return TranslationPack.create({
      language_code,
      name: name || FALLBACK_PACKS[language_code]?.name || language_code,
      native_name:
        native_name || FALLBACK_PACKS[language_code]?.native_name || language_code,
      translations: translations || {},
      version: 1,
      is_active: is_active ?? true,
    });
  }

  const nextTranslations =
    mode === "merge"
      ? deepMerge(existing.translations || {}, translations || {})
      : translations || existing.translations;

  await existing.update({
    name: name ?? existing.name,
    native_name: native_name ?? existing.native_name,
    translations: nextTranslations,
    is_active: is_active ?? existing.is_active,
    version: existing.version + 1,
  });
  return existing;
};

export const setActive = async (language_code, is_active) => {
  const { TranslationPack } = getMasterModels();
  const pack = await TranslationPack.findOne({ where: { language_code } });
  if (!pack) return null;
  await pack.update({ is_active, version: pack.version + 1 });
  return pack;
};

// Deep-merges two plain objects. Arrays are replaced wholesale (not concatted)
// because translation arrays are usually full enumerations.
function deepMerge(target, source) {
  if (!source || typeof source !== "object") return target;
  const out = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      out[key] = deepMerge(out[key] || {}, val);
    } else {
      out[key] = val;
    }
  }
  return out;
}
