// i18nController.js
//
// Public endpoints serve the language manifest + packs. Super-admin endpoints
// allow editing packs and toggling active state. Tenant-default language and
// per-user preference live elsewhere (super-admin tenants controller and
// meController, respectively).

import * as i18nService from "../services/i18nService.js";
import AppError from "../utils/AppError.js";

export const getManifest = async (req, res, next) => {
  try {
    const manifest = await i18nService.listManifest();
    res.json({ status: "success", data: { languages: manifest } });
  } catch (err) {
    next(err);
  }
};

export const getPack = async (req, res, next) => {
  try {
    const { lang } = req.params;
    if (!/^[a-z]{2,5}(-[a-z0-9]{2,8})?$/i.test(lang)) {
      throw new AppError("Invalid language code.", 400);
    }
    const pack = await i18nService.getPack(lang);
    if (!pack) throw new AppError("Language pack not found.", 404);

    // The /pack/{{lng}} contract used by i18next-http-backend expects the
    // bare translations object — not a wrapper — so they merge cleanly into
    // the in-memory store. We include version + meta in headers for the
    // frontend cache.
    //
    // MySQL JSON columns occasionally come back as a string depending on
    // driver/sequelize version, so we normalize defensively before sending.
    let body = pack.translations || {};
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    res.set("X-Pack-Version", String(pack.version));
    res.set("X-Pack-Native-Name", encodeURIComponent(pack.native_name));
    res.json(body);
  } catch (err) {
    next(err);
  }
};

// Super-admin: list / inspect / upsert / toggle
export const adminListPacks = async (_req, res, next) => {
  try {
    const list = await i18nService.listManifest();
    res.json({ status: "success", data: { packs: list } });
  } catch (err) {
    next(err);
  }
};

export const adminGetPack = async (req, res, next) => {
  try {
    const pack = await i18nService.getPack(req.params.lang);
    if (!pack) throw new AppError("Language pack not found.", 404);
    res.json({ status: "success", data: { pack } });
  } catch (err) {
    next(err);
  }
};

export const adminUpsertPack = async (req, res, next) => {
  try {
    const { lang } = req.params;
    const { name, native_name, translations, is_active, mode } = req.body || {};
    if (translations && typeof translations !== "object") {
      throw new AppError("translations must be an object.", 400);
    }
    const pack = await i18nService.upsertPack({
      language_code: lang,
      name,
      native_name,
      translations,
      is_active,
      mode: mode === "merge" ? "merge" : "replace",
    });
    res.json({ status: "success", data: { pack } });
  } catch (err) {
    next(err);
  }
};

export const adminSetActive = async (req, res, next) => {
  try {
    const { lang } = req.params;
    const { is_active } = req.body || {};
    if (typeof is_active !== "boolean") {
      throw new AppError("is_active must be a boolean.", 400);
    }
    const pack = await i18nService.setActive(lang, is_active);
    if (!pack) throw new AppError("Language pack not found.", 404);
    res.json({ status: "success", data: { pack } });
  } catch (err) {
    next(err);
  }
};
