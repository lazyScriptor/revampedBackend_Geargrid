// i18nRoutes.js
//
// Public:
//   GET  /api/i18n/manifest         — list active languages with versions
//   GET  /api/i18n/pack/:lang       — full translation pack (used by
//                                     i18next-http-backend on the frontend)
//
// Super-admin (also mounted under /api/super-admin/i18n via superAdminRoutes
// where the protectSuperAdmin middleware is applied):
//   GET    /packs
//   GET    /packs/:lang
//   PUT    /packs/:lang            — replace/merge translations
//   PATCH  /packs/:lang/active     — toggle is_active

import express from "express";
import * as i18nController from "../controllers/i18nController.js";

const router = express.Router();

router.get("/manifest", i18nController.getManifest);
router.get("/pack/:lang", i18nController.getPack);

export default router;
