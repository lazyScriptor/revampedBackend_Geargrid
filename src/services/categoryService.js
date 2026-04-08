import { Op } from 'sequelize';
import AppError from '../utils/AppError.js';

export const createCategory = async (models, data) => {
  const existing = await models.EquipmentCategory.findOne({ where: { category_name: data.category_name } });
  if (existing) throw new AppError('Category name already exists.', 400);
  return await models.EquipmentCategory.create(data);
};

export const getAllCategories = async (models, queryParams) => {
  const page = parseInt(queryParams.page) || 1;
  const limit = parseInt(queryParams.limit) || 20;
  const offset = (page - 1) * limit;

  const whereClause = {};
  if (queryParams.search) {
    const searchTerm = `%${queryParams.search}%`;
    whereClause[Op.or] = [
      { category_name: { [Op.like]: searchTerm } },
      { description: { [Op.like]: searchTerm } }
    ];
  }

  const { count, rows } = await models.EquipmentCategory.findAndCountAll({
    where: whereClause,
    limit,
    offset,
    order: [['category_name', 'ASC']]
  });

  return { totalItems: count, totalPages: Math.ceil(count / limit), currentPage: page, categories: rows };
};

export const getCategoryById = async (models, categoryId) => {
  const category = await models.EquipmentCategory.findByPk(categoryId);
  if (!category) throw new AppError('Category not found.', 404);
  return category;
};

export const updateCategory = async (models, categoryId, updateData) => {
  const category = await getCategoryById(models, categoryId);

  if (updateData.category_name && updateData.category_name !== category.category_name) {
    const existing = await models.EquipmentCategory.findOne({ where: { category_name: updateData.category_name } });
    if (existing) throw new AppError('Category name already exists.', 400);
  }

  await category.update(updateData);
  return category;
};