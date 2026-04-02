import express from 'express';
import { createWarehouse, getWarehouses } from '../controllers/warehouseController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.route('/')
  .get(getWarehouses)
  .post(createWarehouse);

export default router;