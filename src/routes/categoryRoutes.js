import express from 'express';
import { createCategory, getCategories } from '../controllers/categoryController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.route('/')
  .get(getCategories)
  .post(createCategory);

export default router;