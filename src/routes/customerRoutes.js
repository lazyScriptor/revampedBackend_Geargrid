import express from 'express';
import {
  createCustomer,
  getCustomers,
  getSingleCustomer,
  updateCustomer,
  deleteCustomer,
  getParentCustomerOptions,
} from '../controllers/customerController.js';
import { protect, requirePermission } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Secure all customer routes
router.use(protect);

// GET /api/customers?search=John&page=1
// POST /api/customers
router.route('/')
  .get(requirePermission("customer:view"), getCustomers)
  .post(requirePermission("customer:create"), createCustomer);

// Lookup for the "parent customer" dropdown — must be declared BEFORE /:id
// so Express doesn't treat "parents" as an id.
router.get(
  '/parents',
  requirePermission("customer:view"),
  getParentCustomerOptions,
);

// GET    /api/customers/5
// PUT    /api/customers/5  (full update, kept for backwards compat)
// PATCH  /api/customers/5  (partial update, used by the React form)
// DELETE /api/customers/5  (soft delete)
router.route('/:id')
  .get(requirePermission("customer:view"), getSingleCustomer)
  .put(requirePermission("customer:edit"), updateCustomer)
  .patch(requirePermission("customer:edit"), updateCustomer)
  .delete(requirePermission("customer:edit"), deleteCustomer);

export default router;