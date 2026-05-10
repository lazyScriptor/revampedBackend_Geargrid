import express from "express";
import * as expenseController from "../controllers/expenseController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All expense routes require authentication
router.use(protect);

router.get("/", expenseController.getExpenses);
router.post("/", expenseController.createExpense);
router.patch("/:id", expenseController.updateExpense);
router.delete("/:id", expenseController.deleteExpense);

export default router;
