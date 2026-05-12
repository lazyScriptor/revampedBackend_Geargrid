import express from "express";
import {
  getUsers,
  toggleUserStatus,
  assignRoles,
  getTechnicianRoster,
  addTechnician,
  editTechnician,
} from "../controllers/userController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect);

// --- WORKFORCE / TECHNICIAN ROUTES ---
// (Must come before /:id routes so Express doesn't think "technicians" is an ID!)
router.get("/technicians/roster", requirePermission("workforce:view"), getTechnicianRoster);
router.post("/technicians", requirePermission("workforce:manage"), addTechnician);

// --- GENERAL USER ROUTES ---
router.get("/", requirePermission("user:view"), getUsers);
router.patch("/:id/status", requirePermission("user:manage"), toggleUserStatus);
router.post("/:id/roles", requirePermission("role:manage"), assignRoles);
router.patch("/technicians/:id", requirePermission("workforce:manage"), editTechnician);

export default router;
