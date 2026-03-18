import express from "express";
import { login, verifyAuth } from "../controllers/authController.js";
import validate from "../middlewares/validateInput.js";
import { loginSchema } from "../schemas/authSchema.js";
import { verifyToken } from "../middlewares/authMiddleware.js";

const router = express.Router();

// ------------------------------------------------------------------
// API 1: LOGIN (/api/auth/login)
// Validates payload -> Checks DB -> Returns JWT
// ------------------------------------------------------------------
router.post("/login", validate(loginSchema), login);

// ------------------------------------------------------------------
// API 2: VERIFY (/api/auth/verify)
// Intercepts request with verifyToken middleware -> Returns success
// (Replaces your old /isUserAuth endpoint)
// ------------------------------------------------------------------
router.get("/verify", verifyToken, verifyAuth);

export default router;
