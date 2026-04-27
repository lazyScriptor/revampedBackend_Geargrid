import express from "express";
import {
  getUsers,
  toggleUserStatus,
  assignRoles,
  getTechnicianRoster,
  addTechnician,
  editTechnician,
} from "../controllers/userController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect);

// --- WORKFORCE / TECHNICIAN ROUTES ---
// (Must come before /:id routes so Express doesn't think "technicians" is an ID!)
router.get("/technicians/roster", getTechnicianRoster);
router.post("/technicians", addTechnician);

// --- GENERAL USER ROUTES ---
router.get("/", getUsers);
router.patch("/:id/status", toggleUserStatus);
router.post("/:id/roles", assignRoles);
router.patch("/technicians/:id", editTechnician);

export default router;
