import express from 'express';
import { createRole, getRoles, assignPermissions } from '../controllers/roleController.js';
import { protect, requirePermission } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);

// GET /api/roles
// POST /api/roles
router.route('/')
  .get(requirePermission("role:view"), getRoles)
  .post(requirePermission("role:manage"), createRole);

// POST /api/roles/:id/permissions
router.post('/:id/permissions', requirePermission("role:manage"), assignPermissions);

export default router;