import { Op } from "sequelize";
import AppError from "../utils/AppError.js";

// --- CREATE ---
export const createExpense = async (models, payload, userId) => {
  const expense = await models.Expense.create({
    category: payload.category,
    amount: payload.amount,
    date: payload.date || new Date(),
    description: payload.description || null,
    recorded_by_user_id: userId,
    warehouse_id: payload.warehouse_id || null,
  });
  return expense;
};

// --- GET ALL (Paginated + Filtered) ---
export const getAllExpenses = async (models, queryParams) => {
  const page = parseInt(queryParams.page) || 1;
  const limit = parseInt(queryParams.limit) || 25;
  const offset = (page - 1) * limit;

  const whereClause = {};

  if (queryParams.category) {
    whereClause.category = queryParams.category;
  }

  if (queryParams.startDate && queryParams.endDate) {
    whereClause.date = {
      [Op.between]: [queryParams.startDate, queryParams.endDate],
    };
  }

  if (queryParams.warehouse_id) {
    whereClause.warehouse_id = queryParams.warehouse_id;
  }

  const { count, rows } = await models.Expense.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: models.User,
        attributes: ["user_id", "username"],
      },
      {
        model: models.Warehouse,
        attributes: ["warehouse_id", "location_name"],
      },
    ],
    limit,
    offset,
    order: [["date", "DESC"]],
  });

  return { totalItems: count, expenses: rows };
};

// --- UPDATE ---
export const updateExpense = async (models, expenseId, payload) => {
  const expense = await models.Expense.findByPk(expenseId);
  if (!expense) throw new AppError("Expense record not found.", 404);

  await expense.update({
    category: payload.category ?? expense.category,
    amount: payload.amount ?? expense.amount,
    date: payload.date ?? expense.date,
    description: payload.description ?? expense.description,
    warehouse_id: payload.warehouse_id ?? expense.warehouse_id,
  });

  return expense;
};

// --- DELETE ---
export const deleteExpense = async (models, expenseId) => {
  const expense = await models.Expense.findByPk(expenseId);
  if (!expense) throw new AppError("Expense record not found.", 404);

  await expense.destroy();
  return true;
};
