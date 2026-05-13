import { Op, QueryTypes, fn, col, literal } from "sequelize";

// ============================================================================
// HELPER: Build a Sequelize WHERE clause from common filter params
// ============================================================================
const buildDateFilter = (field, dateFrom, dateTo) => {
  if (dateFrom && dateTo) return { [field]: { [Op.between]: [dateFrom, dateTo] } };
  if (dateFrom) return { [field]: { [Op.gte]: dateFrom } };
  if (dateTo) return { [field]: { [Op.lte]: dateTo } };
  return {};
};

const buildAmountFilter = (field, minAmount, maxAmount) => {
  const clause = {};
  if (minAmount !== undefined && minAmount !== null && minAmount !== "") {
    clause[Op.gte] = parseFloat(minAmount);
  }
  if (maxAmount !== undefined && maxAmount !== null && maxAmount !== "") {
    clause[Op.lte] = parseFloat(maxAmount);
  }
  return Object.keys(clause).length > 0 ? { [field]: clause } : {};
};

const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
};

const parseSorting = (query, allowedFields, defaultField = "createdAt", defaultOrder = "DESC") => {
  const field = allowedFields.includes(query.sortField) ? query.sortField : defaultField;
  const order = ["ASC", "DESC"].includes((query.sortOrder || "").toUpperCase())
    ? query.sortOrder.toUpperCase()
    : defaultOrder;
  return [[field, order]];
};

// ============================================================================
// 1. FILTERED INVOICES
// ============================================================================
export const getFilteredInvoices = async (models, query) => {
  const { page, pageSize, offset } = parsePagination(query);
  const order = parseSorting(query, [
    "invoice_id", "issued_date", "total_amount", "sub_total", "status",
  ], "issued_date", "DESC");

  const where = {
    ...buildDateFilter("issued_date", query.dateFrom, query.dateTo),
    ...buildAmountFilter("total_amount", query.minAmount, query.maxAmount),
  };

  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : query.status.split(",");
    where.status = { [Op.in]: statuses };
  }

  if (query.customer_id) {
    where.customer_id = query.customer_id;
  }

  // Fuzzy search on customer name or invoice ID
  if (query.search) {
    const term = `%${query.search}%`;
    where[Op.or] = [
      { "$Customer.first_name$": { [Op.like]: term } },
      { "$Customer.last_name$": { [Op.like]: term } },
      { "$Customer.company_name$": { [Op.like]: term } },
    ];
    // Also try to match invoice_id if the search looks like a number
    if (!isNaN(query.search)) {
      where[Op.or].push({ invoice_id: parseInt(query.search) });
    }
  }

  const { count, rows } = await models.Invoice.findAndCountAll({
    where,
    include: [
      {
        model: models.Customer,
        attributes: ["customer_id", "first_name", "last_name", "company_name", "customer_type", "phone_number"],
      },
      {
        model: models.Payment,
        attributes: ["payment_id", "payment_amount", "payment_date", "method"],
      },
      {
        model: models.User,
        attributes: ["user_id", "username"],
      },
    ],
    limit: pageSize,
    offset,
    order,
    distinct: true,
    subQuery: false,
  });

  // Compute derived fields
  const invoices = rows.map((inv) => {
    const json = inv.toJSON();
    const totalPaid = (json.Payments || []).reduce((s, p) => s + parseFloat(p.payment_amount || 0), 0);
    return {
      ...json,
      total_paid: totalPaid,
      outstanding: parseFloat(json.sub_total || 0) - totalPaid,
      payment_count: (json.Payments || []).length,
    };
  });

  return { rows: invoices, totalCount: count };
};

// ============================================================================
// 2. FILTERED PAYMENTS
// ============================================================================
export const getFilteredPayments = async (models, query) => {
  const { page, pageSize, offset } = parsePagination(query);
  const order = parseSorting(query, [
    "payment_id", "payment_date", "payment_amount", "method",
  ], "payment_date", "DESC");

  const where = {
    ...buildDateFilter("payment_date", query.dateFrom, query.dateTo),
    ...buildAmountFilter("payment_amount", query.minAmount, query.maxAmount),
  };

  if (query.method) {
    const methods = Array.isArray(query.method) ? query.method : query.method.split(",");
    where.method = { [Op.in]: methods };
  }

  if (query.invoice_id) {
    where.invoice_id = query.invoice_id;
  }

  // Build include with optional customer filter
  const invoiceInclude = {
    model: models.Invoice,
    attributes: ["invoice_id", "customer_id", "total_amount", "status", "issued_date"],
    include: [
      {
        model: models.Customer,
        attributes: ["customer_id", "first_name", "last_name", "company_name", "customer_type"],
      },
    ],
  };

  if (query.customer_id) {
    invoiceInclude.where = { customer_id: query.customer_id };
  }

  if (query.search) {
    const term = `%${query.search}%`;
    invoiceInclude.include[0].where = {
      [Op.or]: [
        { first_name: { [Op.like]: term } },
        { last_name: { [Op.like]: term } },
        { company_name: { [Op.like]: term } },
      ],
    };
  }

  const { count, rows } = await models.Payment.findAndCountAll({
    where,
    include: [invoiceInclude],
    limit: pageSize,
    offset,
    order,
    distinct: true,
    subQuery: false,
  });

  return { rows, totalCount: count };
};

// ============================================================================
// 3. FILTERED EXPENSES (Enhanced)
// ============================================================================
export const getFilteredExpenses = async (models, query) => {
  const { page, pageSize, offset } = parsePagination(query);
  const order = parseSorting(query, [
    "expense_id", "date", "amount", "category",
  ], "date", "DESC");

  const where = {
    ...buildDateFilter("date", query.dateFrom, query.dateTo),
    ...buildAmountFilter("amount", query.minAmount, query.maxAmount),
  };

  if (query.category) {
    const cats = Array.isArray(query.category) ? query.category : query.category.split(",");
    where.category = { [Op.in]: cats };
  }

  if (query.warehouse_id) {
    where.warehouse_id = query.warehouse_id;
  }

  if (query.recorded_by) {
    where.recorded_by_user_id = query.recorded_by;
  }

  if (query.search) {
    where.description = { [Op.like]: `%${query.search}%` };
  }

  const { count, rows } = await models.Expense.findAndCountAll({
    where,
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
    limit: pageSize,
    offset,
    order,
    distinct: true,
  });

  return { rows, totalCount: count };
};

// ============================================================================
// 4. TRANSACTION JOURNAL (Unified income/expense chronological view)
// ============================================================================
export const getTransactionJournal = async (models, query) => {
  const { page, pageSize, offset } = parsePagination(query);
  const sequelize = models.sequelize;

  // Build date and amount WHERE fragments for raw SQL
  let dateClause = "";
  let amountClause = "";
  const replacements = {};

  if (query.dateFrom) {
    dateClause += " AND date >= :dateFrom";
    replacements.dateFrom = query.dateFrom;
  }
  if (query.dateTo) {
    dateClause += " AND date <= :dateTo";
    replacements.dateTo = query.dateTo;
  }
  if (query.minAmount) {
    amountClause += " AND amount >= :minAmount";
    replacements.minAmount = parseFloat(query.minAmount);
  }
  if (query.maxAmount) {
    amountClause += " AND amount <= :maxAmount";
    replacements.maxAmount = parseFloat(query.maxAmount);
  }

  let typeClause = "";
  if (query.type === "income") {
    typeClause = " AND type = 'income'";
  } else if (query.type === "expense") {
    typeClause = " AND type = 'expense'";
  }

  // UNION query: payments as income, expenses as outflow
  const countSql = `
    SELECT COUNT(*) as total FROM (
      SELECT p.payment_id as id, p.payment_date as date, 'income' as type,
             p.payment_amount as amount
      FROM PAYMENTS p
      WHERE 1=1 ${dateClause.replace(/\bdate\b/g, "p.payment_date")} ${amountClause.replace(/\bamount\b/g, "p.payment_amount")}

      UNION ALL

      SELECT e.expense_id as id, e.date as date, 'expense' as type,
             e.amount as amount
      FROM EXPENSES e
      WHERE 1=1 ${dateClause.replace(/\bdate\b/g, "e.date")} ${amountClause.replace(/\bamount\b/g, "e.amount")}
    ) as journal WHERE 1=1 ${typeClause}
  `;

  const dataSql = `
    SELECT * FROM (
      SELECT
        p.payment_id as id,
        p.payment_date as date,
        'income' as type,
        CONCAT('Payment for Invoice #', p.invoice_id) as description,
        CONCAT('INV-', p.invoice_id) as reference,
        p.method as category,
        p.payment_amount as amount,
        p.invoice_id as ref_id
      FROM PAYMENTS p
      WHERE 1=1 ${dateClause.replace(/\bdate\b/g, "p.payment_date")} ${amountClause.replace(/\bamount\b/g, "p.payment_amount")}

      UNION ALL

      SELECT
        e.expense_id as id,
        e.date as date,
        'expense' as type,
        COALESCE(e.description, 'Expense') as description,
        CONCAT('EXP-', e.expense_id) as reference,
        e.category as category,
        e.amount as amount,
        NULL as ref_id
      FROM EXPENSES e
      WHERE 1=1 ${dateClause.replace(/\bdate\b/g, "e.date")} ${amountClause.replace(/\bamount\b/g, "e.amount")}
    ) as journal
    WHERE 1=1 ${typeClause}
    ORDER BY date DESC, id DESC
    LIMIT :limit OFFSET :offset
  `;

  const countResult = await sequelize.query(countSql, {
    replacements,
    type: QueryTypes.SELECT,
  });
  const total = countResult?.[0]?.total || 0;

  const rows = await sequelize.query(dataSql, {
    replacements: { ...replacements, limit: pageSize, offset },
    type: QueryTypes.SELECT,
  });

  return { rows, totalCount: parseInt(total) || 0 };
};

// ============================================================================
// 5. CHART DATA AGGREGATION (For Dashboard/Workstation)
// ============================================================================
export const getChartData = async (models, query) => {
  const sequelize = models.sequelize;
  const replacements = {};
  
  let dateClauseP = "";
  let dateClauseE = "";
  let dateClauseI = "";
  
  if (query.dateFrom) {
    dateClauseP += " AND p.payment_date >= :dateFrom";
    dateClauseE += " AND e.date >= :dateFrom";
    dateClauseI += " AND i.issued_date >= :dateFrom";
    replacements.dateFrom = query.dateFrom;
  }
  if (query.dateTo) {
    dateClauseP += " AND p.payment_date <= :dateTo";
    dateClauseE += " AND e.date <= :dateTo";
    dateClauseI += " AND i.issued_date <= :dateTo";
    replacements.dateTo = query.dateTo;
  }

  // 1. Cash Flow / Income vs Expense (For Overview/Journal)
  const cashFlowSql = `
    SELECT date, SUM(income) as income, SUM(expense) as expense FROM (
      SELECT p.payment_date as date, p.payment_amount as income, 0 as expense
      FROM PAYMENTS p WHERE 1=1 ${dateClauseP}
      UNION ALL
      SELECT e.date as date, 0 as income, e.amount as expense
      FROM EXPENSES e WHERE 1=1 ${dateClauseE}
    ) as flow
    GROUP BY date
    ORDER BY date ASC
  `;
  const cashFlow = await sequelize.query(cashFlowSql, { replacements, type: QueryTypes.SELECT });

  // 2. Expenses by Category (For Expenses Tab)
  const expenseCatSql = `
    SELECT e.category as name, SUM(e.amount) as value
    FROM EXPENSES e WHERE 1=1 ${dateClauseE}
    GROUP BY e.category
    ORDER BY value DESC
  `;
  const expensesByCategory = await sequelize.query(expenseCatSql, { replacements, type: QueryTypes.SELECT });

  // 3. Invoices by Status (For Invoices/Receivables Tab)
  const invoicesByStatusSql = `
    SELECT i.status as name, SUM(i.total_amount) as value, COUNT(*) as count
    FROM INVOICES i WHERE 1=1 ${dateClauseI}
    GROUP BY i.status
  `;
  const invoicesByStatus = await sequelize.query(invoicesByStatusSql, { replacements, type: QueryTypes.SELECT });

  // 4. Payments by Method (For Payments Tab)
  const paymentsByMethodSql = `
    SELECT p.method as name, SUM(p.payment_amount) as value
    FROM PAYMENTS p WHERE 1=1 ${dateClauseP}
    GROUP BY p.method
    ORDER BY value DESC
  `;
  const paymentsByMethod = await sequelize.query(paymentsByMethodSql, { replacements, type: QueryTypes.SELECT });

  return {
    cashFlow,
    expensesByCategory,
    invoicesByStatus,
    paymentsByMethod
  };
};
