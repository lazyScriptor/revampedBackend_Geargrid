import { Op } from 'sequelize';
import AppError from '../utils/AppError.js';

export const createCustomer = async (models, data) => {
  // 1. Uniqueness Check: Ensure email doesn't already exist in this tenant's DB
  if (data.email) {
    const existingCustomer = await models.Customer.findOne({ where: { email: data.email } });
    if (existingCustomer) {
      throw new AppError('A customer with this email already exists.', 400);
    }
  }

  // 2. Create the customer
  return await models.Customer.create(data);
};

export const getAllCustomers = async (models, queryParams) => {
  // 1. Pagination setup
  const page = parseInt(queryParams.page) || 1;
  const limit = parseInt(queryParams.limit) || 20;
  const offset = (page - 1) * limit;

  // 2. Dynamic Search (Search by name, email, or phone number)
  const whereClause = {};
  if (queryParams.search) {
    const searchTerm = `%${queryParams.search}%`;
    whereClause[Op.or] = [
      { first_name: { [Op.like]: searchTerm } },
      { last_name: { [Op.like]: searchTerm } },
      { email: { [Op.like]: searchTerm } },
      { phone_number: { [Op.like]: searchTerm } },
      { nic_no: { [Op.like]: searchTerm } } // Important for rentals!
    ];
  }

  // 3. Execute Query
  const { count, rows } = await models.Customer.findAndCountAll({
    where: whereClause,
    limit,
    offset,
    order: [['createdAt', 'DESC']]
  });

  return {
    totalItems: count,
    totalPages: Math.ceil(count / limit),
    currentPage: page,
    customers: rows
  };
};

export const getCustomerById = async (models, customerId) => {
  // When we fetch a single customer, let's also pull their rental history!
  const customer = await models.Customer.findByPk(customerId, {
    include: [{
      model: models.Invoice,
      attributes: ['invoice_id', 'total_amount', 'status', 'created_at'],
      // We limit to the 5 most recent invoices to prevent massive payload sizes
      limit: 5,
      order: [['created_at', 'DESC']]
    }]
  });

  if (!customer) throw new AppError('Customer not found.', 404);
  return customer;
};

export const updateCustomer = async (models, customerId, updateData) => {
  const customer = await getCustomerById(models, customerId);

  // If they are updating the email, ensure it doesn't belong to someone else
  if (updateData.email && updateData.email !== customer.email) {
    const existing = await models.Customer.findOne({ where: { email: updateData.email } });
    if (existing) throw new AppError('This email is already in use by another customer.', 400);
  }

  await customer.update(updateData);
  return customer;
};