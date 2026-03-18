import * as customerService from "../services/customerService.js";
import catchAsync from "../utils/catchAsync.js";

export const getCustomers = catchAsync(async (req, res) => {
  // Pass the entire req.query object to the service
  const customers = await customerService.getAllCustomers(req.query);
  res.status(200).json(customers);
});

export const getCustomerById = catchAsync(async (req, res) => {
  const customer = await customerService.getCustomerById(req.params.id);
  res.status(200).json(customer);
});

export const createCustomer = catchAsync(async (req, res) => {
  const newCustomer = await customerService.createCustomer(req.body);
  res.status(201).json({
    message: `Customer details updated for the customer with id : ${newCustomer.cus_id}`,
    insertId: newCustomer.cus_id, // Kept for backwards compatibility with your frontend
  });
});

export const updateCustomer = catchAsync(async (req, res) => {
  // Your old frontend sent the ID inside the body. In REST, we send it in the URL (e.g., PUT /api/customers/5)
  // But we will allow both to keep your frontend working for now.
  const id = req.params.id || req.body.id;
  await customerService.updateCustomer(id, req.body);
  res.status(200).json({
    message: `Customer details updated for the customer with id : ${id}`,
  });
});

export const deleteCustomer = catchAsync(async (req, res) => {
  await customerService.deleteCustomer(req.params.id);
  res
    .status(200)
    .json({ message: `Deleted customer with ID ${req.params.id}` });
});

export const getChildren = catchAsync(async (req, res) => {
  const children = await customerService.getChildren(req.params.parentId);
  res.status(200).json({ status: true, children });
});
