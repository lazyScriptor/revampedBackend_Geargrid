import * as expenseService from "../services/expenseService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

export const createExpense = catchAsync(async (req, res) => {
  const userId = req.user?.id || 1;
  const expense = await expenseService.createExpense(getModels(req), req.body, userId);
  res.status(201).json({
    status: "success",
    message: "Expense recorded successfully.",
    data: { expense },
  });
});

export const getExpenses = catchAsync(async (req, res) => {
  const result = await expenseService.getAllExpenses(getModels(req), req.query);
  res.status(200).json({
    status: "success",
    data: result,
  });
});

export const updateExpense = catchAsync(async (req, res) => {
  const expense = await expenseService.updateExpense(getModels(req), req.params.id, req.body);
  res.status(200).json({
    status: "success",
    message: "Expense updated successfully.",
    data: { expense },
  });
});

export const deleteExpense = catchAsync(async (req, res) => {
  await expenseService.deleteExpense(getModels(req), req.params.id);
  res.status(200).json({
    status: "success",
    message: "Expense deleted successfully.",
  });
});
