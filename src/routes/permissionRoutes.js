import express from 'express';
import { getPermissions } from '../controllers/permissionController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);

// GET /api/permissions
router.get('/', getPermissions);

export default router;