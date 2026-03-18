import express from "express";
import {
  login,
  verifyAuth,
  refresh,
  logout,
  getRolesByUsername,
} from "../controllers/authController.js";
import validate from "../middlewares/validateInput.js";
import { loginSchema } from "../schemas/authSchema.js";
import { verifyToken } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/login", validate(loginSchema), login);
router.get("/refresh", refresh); // Endpoint to get a new access token
router.post("/logout", logout); // Endpoint to clear cookies
router.get("/verify", verifyToken, verifyAuth); // Protected route
router.get("/roles/:username", getRolesByUsername);

export default router;
