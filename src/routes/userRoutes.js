import express from 'express';
import { getUsers, toggleUserStatus, assignRoles } from '../controllers/userController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Apply the protect middleware to ALL routes in this file
router.use(protect);

// GET /api/users
router.get('/', getUsers);

// PATCH /api/users/:id/status
router.patch('/:id/status', toggleUserStatus);

// POST /api/users/:id/roles
router.post('/:id/roles', assignRoles);

export default router;