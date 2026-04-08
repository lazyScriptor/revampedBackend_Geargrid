import express from 'express';
import { 
  createEquipment, 
  getEquipment, 
  getSingleEquipment, 
  updateEquipment, 
  changeStatus 
} from '../controllers/equipmentController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

// All equipment routes require the user to be logged in
router.use(protect);

// GET /api/equipment?page=1&limit=20&status=Available&search=Bosch
// POST /api/equipment
router.route('/')
  .get(getEquipment)
  .post(createEquipment);

// GET /api/equipment/5
// PUT /api/equipment/5 (Full/Partial update of details like price, name)
router.route('/:id')
  .get(getSingleEquipment)
  .put(updateEquipment);

// PATCH /api/equipment/5/status (Specific endpoint just for changing status)
router.patch('/:id/status', changeStatus);

export default router;