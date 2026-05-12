import express from 'express';
import { createWarehouse, getWarehouses, getSingleWarehouse, updateWarehouse } from '../controllers/warehouseController.js';
import { protect, requirePermission } from '../middlewares/authMiddleware.js';

const router = express.Router();
router.use(protect);

router.route('/')
  .get(requirePermission("warehouse:view"), getWarehouses)
  .post(requirePermission("warehouse:manage"), createWarehouse);

router.route('/:id')
  .get(requirePermission("warehouse:view"), getSingleWarehouse)
  .put(requirePermission("warehouse:manage"), updateWarehouse);

export default router;