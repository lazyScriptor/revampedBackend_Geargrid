import express from 'express';
import * as customerController from '../controllers/customerController.js';
import validate from '../middlewares/validateInput.js';
import { customerSchema } from '../schemas/customerSchema.js';
import { verifyToken } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Apply the verifyToken middleware to all customer routes
router.use(verifyToken);

// Standard REST Routes
router.route('/')
  .get(customerController.getCustomers) // GET /api/customers (supports ?search=value)
  .post(validate(customerSchema), customerController.createCustomer); // POST /api/customers

router.route('/:id')
  .get(customerController.getCustomerById) // GET /api/customers/:id
  .put(validate(customerSchema), customerController.updateCustomer) // PUT /api/customers/:id
  .delete(customerController.deleteCustomer); // DELETE /api/customers/:id

// Parent/Child Routes
router.route('/:parentId/children')
  .get(customerController.getChildren); // GET /api/customers/:parentId/children

// Old route mapping (if you don't want to change frontend right away)
// You can use the standard POST /api/customers for creating children too, but mapping this just in case:
router.post('/child', validate(customerSchema), customerController.createCustomer);

export default router;