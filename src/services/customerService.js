import { Op } from "sequelize";
import { Customer } from "../models/index.js";
import AppError from "../utils/AppError.js";

export const getAllCustomers = async (queryParams) => {
  const { search, exactPhone, exactNic } = queryParams;
  
  // Base condition: only fetch non-deleted customers
  const whereCondition = { cus_delete_status: 0 };

  // Specific lookups for your frontend live-validation
  if (exactPhone) whereCondition.cus_phone_number = exactPhone;
  if (exactNic) whereCondition.nic = exactNic;

  // General search across multiple fields
  if (search) {
    if (!isNaN(search) && search < 1000) {
      whereCondition.cus_id = { [Op.like]: `%${search}%` };
    } else {
      const formattedValue = `%${search}%`;
      whereCondition[Op.or] = [
        { nic: { [Op.like]: formattedValue } },
        { cus_phone_number: { [Op.like]: formattedValue } },
        { cus_fname: { [Op.like]: formattedValue } },
        { cus_lname: { [Op.like]: formattedValue } },
        { cus_address1: { [Op.like]: formattedValue } },
        { cus_address2: { [Op.like]: formattedValue } }
      ];
    }
  }

  return await Customer.findAll({ where: whereCondition });
};

export const getCustomerById = async (id) => {
  const customer = await Customer.findOne({
    where: { cus_id: id, cus_delete_status: 0 },
  });
  if (!customer) throw new AppError("Customer not found", 404);
  return customer;
};

export const createCustomer = async (data) => {
  // Guard against duplicate Phone or NIC (based on your old createChildCustomer logic)
  if (data.nic) {
    const existingNic = await Customer.findOne({
      where: { nic: data.nic, cus_delete_status: 0 },
    });
    if (existingNic)
      throw new AppError("A customer with this NIC already exists", 409);
  }

  const existingPhone = await Customer.findOne({
    where: { cus_phone_number: data.phoneNumber, cus_delete_status: 0 },
  });
  if (existingPhone)
    throw new AppError("A customer with this phone number already exists", 409);

  return await Customer.create({
    cus_fname: data.fname,
    cus_lname: data.lname,
    nic: data.nic,
    cus_phone_number: data.phoneNumber,
    cus_address1: data.address1,
    cus_address2: data.address2,
    cus_parent_id: data.parentId || null,
  });
};

export const updateCustomer = async (id, data) => {
  const customer = await getCustomerById(id); // Ensures customer exists

  await customer.update({
    cus_fname: data.fname,
    cus_lname: data.lname,
    nic: data.nic,
    cus_phone_number: data.phoneNumber,
    cus_address1: data.address1,
    cus_address2: data.address2,
  });
  return customer;
};

export const deleteCustomer = async (id) => {
  const customer = await getCustomerById(id);
  // Soft delete
  await customer.update({ cus_delete_status: 1 });
  return customer;
};

export const getChildren = async (parentId) => {
  return await Customer.findAll({
    where: { cus_parent_id: parentId, cus_delete_status: 0 },
    order: [
      ["cus_fname", "ASC"],
      ["cus_lname", "ASC"],
    ],
  });
};
