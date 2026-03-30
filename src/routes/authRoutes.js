import express from "express";
import { register, login, verifyAuth } from "../controllers/authController.js";
import { protect } from "../middlewares/authMiddleware.js";

// 1. Import your validation tools
import validate from "../middlewares/validateInput.js";
import { registerSchema, loginSchema } from "../schemas/authSchema.js";

const router = express.Router();

// 2. Inject the validate middleware BEFORE the controller
router.post("/register", validate(registerSchema), register);
router.post("/login", validate(loginSchema), login);

// Protected Routes
router.get("/verify", protect, verifyAuth);

export default router;
