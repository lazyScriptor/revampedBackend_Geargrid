import express from 'express';
import { 
  createCustomer, 
  getCustomers, 
  getSingleCustomer, 
  updateCustomer 
} from '../controllers/customerController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Secure all customer routes
router.use(protect);

// GET /api/customers?search=John&page=1
// POST /api/customers
router.route('/')
  .get(getCustomers)
  .post(createCustomer);

// GET /api/customers/5
// PUT /api/customers/5
router.route('/:id')
  .get(getSingleCustomer)
  .put(updateCustomer);

export default router;