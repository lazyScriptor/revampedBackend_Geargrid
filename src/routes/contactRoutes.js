// src/routes/contactRoutes.js
import express from "express";
import { sendDemoRequest } from "../controllers/contactController.js";

const router = express.Router();

// Route: POST /api/contact/request-demo
router.post("/request-demo", sendDemoRequest);

export default router;
