import express from "express";
import * as whatsapp from "../controllers/whatsappController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";
import { freshAccruals } from "../services/accrualService.js";

const router = express.Router();

router.use(protect);
// Totals include the running charges of machines still out; bring them up to date first.
router.use(freshAccruals);

// Using the hub (compose, open a chat, history, opt-out)
router.get("/worklist", requirePermission("whatsapp:send"), whatsapp.getWorklist);
router.post("/compose", requirePermission("whatsapp:send"), whatsapp.compose);
router.post("/log", requirePermission("whatsapp:send"), whatsapp.logMessage);
router.patch("/log/:id/sent", requirePermission("whatsapp:send"), whatsapp.confirmSent);
router.get("/log", requirePermission("whatsapp:send"), whatsapp.listLog);
router.get("/templates", requirePermission("whatsapp:send"), whatsapp.getTemplates);
router.get("/settings", requirePermission("whatsapp:send"), whatsapp.getSettings);
router.patch("/customers/:id/opt-out", requirePermission("whatsapp:send"), whatsapp.setOptOut);

// Changing the shop's wording / settings
router.put("/templates/:key/:language", requirePermission("whatsapp:manage"), whatsapp.saveTemplate);
router.delete("/templates/:key/:language", requirePermission("whatsapp:manage"), whatsapp.resetTemplate);
router.put("/settings", requirePermission("whatsapp:manage"), whatsapp.updateSettings);

export default router;
