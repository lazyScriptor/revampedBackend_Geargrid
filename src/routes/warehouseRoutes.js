import express from 'express';
import { createWarehouse, getWarehouses, getSingleWarehouse, updateWarehouse } from '../controllers/warehouseController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();
router.use(protect);

router.route('/')
  .get(getWarehouses)
  .post(createWarehouse);

router.route('/:id')
  .get(getSingleWarehouse)
  .put(updateWarehouse);

export default router;