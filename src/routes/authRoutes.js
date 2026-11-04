import express from "express";
import rateLimit from "express-rate-limit";
import {
  register,
  login,
  verifyAuth,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
} from "../controllers/authController.js";
import { protect } from "../middlewares/authMiddleware.js";

// 1. Import your validation tools
import validate from "../middlewares/validateInput.js";
import { registerSchema, loginSchema } from "../schemas/authSchema.js";

const router = express.Router();

const tooMany = { status: "error", message: "Too many tries. Please wait a few minutes and try again." };
const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: tooMany });
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: tooMany });

// 2. Inject the validate middleware BEFORE the controller
router.post("/register", validate(registerSchema), register);
router.post("/login", validate(loginSchema), login);
router.post("/forgot-password", forgotLimiter, forgotPassword);
router.post("/reset-password", resetLimiter, resetPassword);
router.post("/refresh", refresh);
router.post("/logout", logout);

// Protected Routes
router.get("/verify", protect, verifyAuth);

export default router;
