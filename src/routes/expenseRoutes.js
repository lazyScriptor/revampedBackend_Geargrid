import express from "express";
import * as expenseController from "../controllers/expenseController.js";
import { protect, requirePermission } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All expense routes require authentication
router.use(protect);

router.get("/", requirePermission("accounting:view"), expenseController.getExpenses);
router.post("/", requirePermission("accounting:manage_expenses"), expenseController.createExpense);
router.patch("/:id", requirePermission("accounting:manage_expenses"), expenseController.updateExpense);
router.delete("/:id", requirePermission("accounting:manage_expenses"), expenseController.deleteExpense);

export default router;
