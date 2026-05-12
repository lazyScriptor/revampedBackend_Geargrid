import express from 'express';
import { 
  createCustomer, 
  getCustomers, 
  getSingleCustomer, 
  updateCustomer 
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

// GET /api/customers/5
// PUT /api/customers/5
router.route('/:id')
  .get(requirePermission("customer:view"), getSingleCustomer)
  .put(requirePermission("customer:edit"), updateCustomer);

export default router;