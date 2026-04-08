import express from 'express';
import { createCategory, getCategories, getSingleCategory, updateCategory } from '../controllers/categoryController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();
router.use(protect);

router.route('/')
  .get(getCategories)
  .post(createCategory);

router.route('/:id')
  .get(getSingleCategory)
  .put(updateCategory);

export default router;