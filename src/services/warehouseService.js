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

/** What still points at a location: it can't go until these have somewhere else to be. */
export const getWarehouseUsage = async (models, warehouseId, { transaction } = {}) => {
  const where = { warehouse_id: warehouseId };
  const [machines, staff, expenses] = await Promise.all([
    models.Equipment.count({ where, transaction }),
    models.User.count({ where, transaction }),
    models.Expense.count({ where, transaction }),
  ]);
  return { machines, staff, expenses };
};

/** Remove a location, moving what is in it to `moveToId` first. All of it happens, or none of it. */
export const deleteWarehouse = async (models, warehouseId, { moveToId } = {}) => {
  const id = Number(warehouseId);
  const target = moveToId === undefined || moveToId === null || moveToId === '' ? null : Number(moveToId);
  return models.sequelize.transaction(async (transaction) => {
    const warehouse = await models.Warehouse.findByPk(id, { transaction, lock: transaction.LOCK?.UPDATE });
    if (!warehouse) throw new AppError('Warehouse not found.', 404);
    if ((await models.Warehouse.count({ transaction })) <= 1) {
      throw new AppError('A shop needs at least one location, so this one cannot be removed.', 400);
    }
    const usage = await getWarehouseUsage(models, id, { transaction });
    if (usage.machines + usage.staff + usage.expenses > 0) {
      if (target === null) {
        throw new AppError('This location still has machines, staff or expenses. Choose where to move them first.', 409);
      }
      if (target === id || !(await models.Warehouse.findByPk(target, { transaction }))) {
        throw new AppError('Choose another location to move them to.', 400);
      }
      const move = { fields: ['warehouse_id'], where: { warehouse_id: id }, transaction };
      await models.Equipment.update({ warehouse_id: target }, move);
      await models.User.update({ warehouse_id: target }, move);
      await models.Expense.update({ warehouse_id: target }, move);
    }
    await warehouse.destroy({ transaction });
    return { moved: usage };
  });
};
