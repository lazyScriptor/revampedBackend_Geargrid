import AppError from '../utils/AppError.js';

export const createCategory = async (models, categoryName, description) => {
  const existingCategory = await models.EquipmentCategory.findOne({ 
    where: { category_name: categoryName } 
  });
  
  if (existingCategory) {
    throw new AppError('Category name already exists.', 400);
  }

  return await models.EquipmentCategory.create({
    category_name: categoryName,
    description: description
  });
};

export const getAllCategories = async (models) => {
  return await models.EquipmentCategory.findAll();
};