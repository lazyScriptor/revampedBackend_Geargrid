import { Op } from "sequelize";
import AppError from "../utils/AppError.js";

export const createCustomer = async (models, data) => {
  // 1. Uniqueness Check: Ensure NIC/Passport doesn't already exist
  if (data.nic_number) {
    const existingCustomer = await models.Customer.findOne({
      where: { nic_number: data.nic_number },
    });
    if (existingCustomer) {
      throw new AppError(
        "A customer with this NIC or Passport already exists.",
        400,
      );
    }
  }

  // 2. Hierarchical Validation: If they are a worker, ensure the parent company exists
  if (data.parent_customer_id) {
    const parent = await models.Customer.findByPk(data.parent_customer_id);
    if (!parent || parent.customer_type !== "Business") {
      throw new AppError(
        "The selected Parent Company is invalid or not a Business account.",
        400,
      );
    }
  }

  // 3. Create the customer
  return await models.Customer.create(data);
};

export const getAllCustomers = async (models, queryParams) => {
  const page = parseInt(queryParams.page) || 1;
  const limit = parseInt(queryParams.limit) || 20;
  const offset = (page - 1) * limit;

  // 1. Base query: Hide soft-deleted customers
  const whereClause = { customer_delete_status: false };

  // 2. Dynamic Search (Optimized for the POS Search Bar)
  if (queryParams.search) {
    const searchTerm = `%${queryParams.search}%`;
    whereClause[Op.or] = [
      { first_name: { [Op.like]: searchTerm } },
      { last_name: { [Op.like]: searchTerm } },
      { company_name: { [Op.like]: searchTerm } }, // CRITICAL: Search by company name
      { phone_number: { [Op.like]: searchTerm } },
      { nic_number: { [Op.like]: searchTerm } }, // CRITICAL: Search by ID card
    ];
  }

  // 3. Execute Query with Relational Includes
  const { count, rows } = await models.Customer.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: models.Customer,
        as: "ParentCompany", // Pulls the parent company data for the frontend badge
        attributes: ["customer_id", "company_name"],
      },
    ],
    limit,
    offset,
    order: [["createdAt", "DESC"]],
  });

  return {
    totalItems: count,
    totalPages: Math.ceil(count / limit),
    currentPage: page,
    customers: rows,
  };
};

export const getCustomerById = async (models, customerId) => {
  // Fetch a single customer with their full CRM context
  const customer = await models.Customer.findOne({
    where: {
      customer_id: customerId,
      customer_delete_status: false,
    },
    include: [
      {
        model: models.Customer,
        as: "ParentCompany",
        attributes: [
          "customer_id",
          "company_name",
          "first_name",
          "last_name",
          "phone_number",
        ],
      },
      {
        model: models.Customer,
        as: "Workers", // If this is a business, who are their workers?
        attributes: [
          "customer_id",
          "first_name",
          "last_name",
          "phone_number",
          "status",
        ],
      },
      {
        model: models.Invoice,
        attributes: ["invoice_id", "total_amount", "status", "issued_date"],
        limit: 5, // Top 5 recent invoices for the POS Snapshot widget
        order: [["issued_date", "DESC"]],
      },
    ],
  });

  if (!customer) throw new AppError("Customer not found.", 404);
  return customer;
};

export const updateCustomer = async (models, customerId, updateData) => {
  // We use the basic findByPk here to avoid pulling in all the relations just to update
  const customer = await models.Customer.findByPk(customerId);
  if (!customer || customer.customer_delete_status) {
    throw new AppError("Customer not found.", 404);
  }

  // If they are updating the NIC, ensure it doesn't belong to someone else
  if (updateData.nic_number && updateData.nic_number !== customer.nic_number) {
    const existing = await models.Customer.findOne({
      where: { nic_number: updateData.nic_number },
    });
    if (existing)
      throw new AppError(
        "This NIC/Passport is already registered to another customer.",
        400,
      );
  }

  await customer.update(updateData);

  // Return the updated customer with full relational data
  return await getCustomerById(models, customerId);
};

// Bonus: Soft Delete logic since you have `customer_delete_status` in your schema
export const deleteCustomer = async (models, customerId) => {
  const customer = await models.Customer.findByPk(customerId);
  if (!customer) throw new AppError("Customer not found.", 404);

  // Instead of completely destroying the record (which breaks old invoices), we soft-delete it
  await customer.update({ customer_delete_status: true });
  return true;
};
