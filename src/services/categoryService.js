import { Op } from "sequelize";
import AppError from "../utils/AppError.js";

// A sub-category's parent must be a top-level category, and a category with sub-categories can't
// become one itself: that keeps the tree at two levels.
const checkParent = async (models, categoryId, parentId) => {
  if (parentId === null || parentId === undefined || parentId === "") return null;
  const pid = Number(parentId);
  if (categoryId && pid === Number(categoryId)) throw new AppError("A category can't be its own parent.", 400);
  const parent = await models.EquipmentCategory.findByPk(pid);
  if (!parent) throw new AppError("Parent category not found.", 404);
  if (parent.parent_id) throw new AppError("Categories only go two levels deep: pick a top-level parent.", 400);
  if (categoryId && (await models.EquipmentCategory.count({ where: { parent_id: categoryId } }))) {
    throw new AppError("This category has sub-categories, so it can't go under another one.", 400);
  }
  return pid;
};

// The same name may be used under different parents ("4 inch" under Grinders and under Cutters).
const nameTaken = (models, name, parentId, exceptId) =>
  models.EquipmentCategory.findOne({
    where: {
      category_name: name,
      parent_id: parentId,
      ...(exceptId ? { category_id: { [Op.ne]: exceptId } } : {}),
    },
  });

export const createCategory = async (models, data) => {
  const parent_id = await checkParent(models, null, data.parent_id);
  if (await nameTaken(models, data.category_name, parent_id)) throw new AppError("Category name already exists.", 400);
  return await models.EquipmentCategory.create({ ...data, parent_id });
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
      { description: { [Op.like]: searchTerm } },
    ];
  }

  const { count, rows: found } = await models.EquipmentCategory.findAndCountAll({
    where: whereClause,
    limit,
    offset,
    order: [["category_name", "ASC"]],
  });

  // Add the parent's name and how many machines sit in each category.
  const all = await models.EquipmentCategory.findAll({ attributes: ["category_id", "category_name"], raw: true });
  const names = new Map(all.map((c) => [c.category_id, c.category_name]));
  const counts = await models.Equipment.findAll({
    attributes: ["category_id", [models.Equipment.sequelize.fn("COUNT", models.Equipment.sequelize.col("equipment_id")), "n"]],
    group: ["category_id"],
    raw: true,
  });
  const perCategory = new Map(counts.map((c) => [c.category_id, Number(c.n)]));
  const rows = found.map((c) => ({
    ...c.toJSON(),
    parent_name: c.parent_id ? names.get(c.parent_id) ?? null : null,
    equipment_count: perCategory.get(c.category_id) ?? 0,
  }));

  return {
    totalItems: count,
    totalPages: Math.ceil(count / limit),
    currentPage: page,
    categories: rows,
  };
};

export const getCategoryById = async (models, categoryId) => {
  const category = await models.EquipmentCategory.findByPk(categoryId);
  if (!category) throw new AppError("Category not found.", 404);
  return category;
};

export const updateCategory = async (models, categoryId, updateData) => {
  const category = await getCategoryById(models, categoryId);

  const parent_id = "parent_id" in updateData ? await checkParent(models, categoryId, updateData.parent_id) : category.parent_id;
  const name = updateData.category_name ?? category.category_name;
  if ((name !== category.category_name || parent_id !== category.parent_id) && (await nameTaken(models, name, parent_id, categoryId))) {
    throw new AppError("Category name already exists.", 400);
  }

  await category.update({ ...updateData, parent_id });
  return category;
};
export const deleteCategory = async (models, id) => {
  // 1. Check if category exists (Match your model name, usually EquipmentCategory or Category)
  const category = await models.EquipmentCategory.findByPk(id);

  if (!category) {
    const error = new Error("Category not found.");
    error.statusCode = 404;
    throw error;
  }

  // 2. SAFETY CHECK: Count equipment using this category
  const equipmentCount = await models.Equipment.count({
    where: { category_id: id },
  });

  if (equipmentCount > 0) {
    const error = new Error(
      `Cannot delete this category. There are ${equipmentCount} equipment items currently assigned to it. Please reassign or delete them first.`,
    );
    error.statusCode = 400; // 400 Bad Request
    throw error;
  }

  const children = await models.EquipmentCategory.count({ where: { parent_id: id } });
  if (children > 0) {
    const error = new Error(`Cannot delete this category: it has ${children} sub-categories. Remove or move them first.`);
    error.statusCode = 400;
    throw error;
  }

  // 3. Safe to delete
  await category.destroy();
  return true;
};
