import { Op } from 'sequelize';
import AppError from '../utils/AppError.js';

export const createWarehouse = async (models, data) => {
  // Prevent duplicate warehouse names
  const existing = await models.Warehouse.findOne({ where: { location_name: data.location_name } });
  if (existing) throw new AppError('A warehouse with this name already exists.', 400);

  // If a manager is provided, ensure they actually exist
  if (data.manager_user_id) {
    const manager = await models.User.findByPk(data.manager_user_id);
    if (!manager) throw new AppError('Invalid manager User ID.', 404);
  }

  return await models.Warehouse.create(data);
};

export const getAllWarehouses = async (models, queryParams) => {
  const page = parseInt(queryParams.page) || 1;
  const limit = parseInt(queryParams.limit) || 20;
  const offset = (page - 1) * limit;

  const whereClause = {};
  if (queryParams.search) {
    const searchTerm = `%${queryParams.search}%`;
    whereClause[Op.or] = [
      { location_name: { [Op.like]: searchTerm } },
      { address: { [Op.like]: searchTerm } }
    ];
  }

  const { count, rows } = await models.Warehouse.findAndCountAll({
    where: whereClause,
    limit,
    offset,
    order: [['location_name', 'ASC']],
    include: [{
      model: models.User,
      attributes: ['user_id', 'first_name', 'last_name', 'email']
    }]
  });

  return { totalItems: count, totalPages: Math.ceil(count / limit), currentPage: page, warehouses: rows };
};

export const getWarehouseById = async (models, warehouseId) => {
  const warehouse = await models.Warehouse.findByPk(warehouseId, {
    include: [{ model: models.User, attributes: ['first_name', 'last_name', 'email'] }]
  });
  if (!warehouse) throw new AppError('Warehouse not found.', 404);
  return warehouse;
};

export const updateWarehouse = async (models, warehouseId, updateData) => {
  const warehouse = await getWarehouseById(models, warehouseId);

  // Check name uniqueness if they are trying to rename it
  if (updateData.location_name && updateData.location_name !== warehouse.location_name) {
    const existing = await models.Warehouse.findOne({ where: { location_name: updateData.location_name } });
    if (existing) throw new AppError('Another warehouse already uses this name.', 400);
  }

  await warehouse.update(updateData);
  return warehouse;
};