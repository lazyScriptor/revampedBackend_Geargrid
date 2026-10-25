import { Op } from "sequelize";
import AppError from "../utils/AppError.js";

// Allowed expense categories. Keep in sync with the frontend list (src/features/accounting/constants).
export const EXPENSE_CATEGORIES = [
  "Operational",
  "Repair",
  "Asset Purchase",
  "Salaries",
  "Rent",
  "Utilities",
  "Fuel & Transport",
  "Marketing",
  "Taxes & Fees",
  "Other",
];

const MAX_AMOUNT = 1_000_000_000;

const clean = (payload, { partial = false } = {}) => {
  const out = {};
  if (!partial || payload.category !== undefined) {
    if (!EXPENSE_CATEGORIES.includes(payload.category)) {
      throw new AppError(`Invalid category. Choose one of: ${EXPENSE_CATEGORIES.join(", ")}.`, 400);
    }
    out.category = payload.category;
  }
  if (!partial || payload.amount !== undefined) {
    const amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      throw new AppError("Amount must be a number greater than 0.", 400);
    }
    out.amount = Math.round(amount * 100) / 100;
  }
  if (payload.date !== undefined && payload.date !== null && payload.date !== "") {
    const d = new Date(payload.date);
    if (Number.isNaN(d.getTime())) throw new AppError("Expense date is not valid.", 400);
    out.date = d;
  }
  if (payload.description !== undefined) {
    out.description = payload.description === null ? null : String(payload.description).trim().slice(0, 1000) || null;
  }
  if (payload.warehouse_id !== undefined) out.warehouse_id = payload.warehouse_id || null;
  return out;
};

const audit = (models, expense_id, action, actorUserId, snapshot, transaction) =>
  models.ExpenseAudit.create({ expense_id, action, actor_user_id: actorUserId ?? null, snapshot }, { transaction });

// --- CREATE ---
export const createExpense = async (models, payload, userId) => {
  const data = clean(payload);
  return models.sequelize.transaction(async (t) => {
    const expense = await models.Expense.create(
      { ...data, date: data.date || new Date(), recorded_by_user_id: userId, warehouse_id: data.warehouse_id ?? null },
      { transaction: t },
    );
    await audit(models, expense.expense_id, "CREATED", userId, expense.toJSON(), t);
    return expense;
  });
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
export const updateExpense = async (models, expenseId, payload, userId) => {
  const data = clean(payload, { partial: true });
  return models.sequelize.transaction(async (t) => {
    const expense = await models.Expense.findByPk(expenseId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!expense) throw new AppError("Expense record not found.", 404);
    const before = expense.toJSON();
    await expense.update(data, { transaction: t });
    await audit(models, expense.expense_id, "UPDATED", userId, { before, after: expense.toJSON() }, t);
    return expense;
  });
};

// --- DELETE (hard delete, but the full record is kept in EXPENSE_AUDIT) ---
export const deleteExpense = async (models, expenseId, userId) => {
  return models.sequelize.transaction(async (t) => {
    const expense = await models.Expense.findByPk(expenseId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!expense) throw new AppError("Expense record not found.", 404);
    await audit(models, expense.expense_id, "DELETED", userId, expense.toJSON(), t);
    await expense.destroy({ transaction: t });
    return true;
  });
};
