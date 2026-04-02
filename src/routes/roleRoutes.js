import express from 'express';
import { createRole, getRoles, assignPermissions } from '../controllers/roleController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);

// GET /api/roles
// POST /api/roles
router.route('/')
  .get(getRoles)
  .post(createRole);

// POST /api/roles/:id/permissions
router.post('/:id/permissions', assignPermissions);

export default router;