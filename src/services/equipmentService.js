import { Op } from 'sequelize';
import AppError from '../utils/AppError.js';

export const createEquipment = async (models, data) => {
  // 1. Data Integrity Checks: Ensure the linked Warehouse and Category actually exist
  const category = await models.EquipmentCategory.findByPk(data.category_id);
  if (!category) throw new AppError('Invalid category ID provided.', 404);

  const warehouse = await models.Warehouse.findByPk(data.warehouse_id);
  if (!warehouse) throw new AppError('Invalid warehouse ID provided.', 404);

  // 2. Uniqueness Check: Ensure serial number isn't already registered
  const existingSerial = await models.Equipment.findOne({ where: { serial_number: data.serial_number } });
  if (existingSerial) throw new AppError('Equipment with this serial number already exists.', 400);

  // 3. Create the item
  return await models.Equipment.create(data);
};

export const getAllEquipment = async (models, queryParams) => {
  // 1. Setup Pagination (Defaults to page 1, 20 items per page)
  const page = parseInt(queryParams.page) || 1;
  const limit = parseInt(queryParams.limit) || 20;
  const offset = (page - 1) * limit;

  // 2. Setup Dynamic Filtering
  const whereClause = {};
  
  if (queryParams.status) whereClause.status = queryParams.status;
  if (queryParams.category_id) whereClause.category_id = queryParams.category_id;
  if (queryParams.warehouse_id) whereClause.warehouse_id = queryParams.warehouse_id;

  // 3. Setup Searching (Search by name OR serial number)
  if (queryParams.search) {
    whereClause[Op.or] = [
      { name: { [Op.like]: `%${queryParams.search}%` } },
      { serial_number: { [Op.like]: `%${queryParams.search}%` } }
    ];
  }

  // 4. Execute the Query with 'findAndCountAll' for pagination metadata
  const { count, rows } = await models.Equipment.findAndCountAll({
    where: whereClause,
    limit,
    offset,
    order: [['createdAt', 'DESC']], // Newest first
    include: [
      { model: models.EquipmentCategory, attributes: ['category_name'] },
      { model: models.Warehouse, attributes: ['location_name'] }
    ]
  });

  return {
    totalItems: count,
    totalPages: Math.ceil(count / limit),
    currentPage: page,
    equipment: rows
  };
};

export const getEquipmentById = async (models, equipmentId) => {
  const equipment = await models.Equipment.findByPk(equipmentId, {
    include: [
      { model: models.EquipmentCategory, attributes: ['category_id', 'category_name'] },
      { model: models.Warehouse, attributes: ['warehouse_id', 'location_name'] }
    ]
  });

  if (!equipment) throw new AppError('Equipment not found.', 404);
  return equipment;
};

export const updateEquipment = async (models, equipmentId, updateData) => {
  const equipment = await getEquipmentById(models, equipmentId); // Re-use the fetch logic

  // If they are trying to change the serial number, ensure it doesn't conflict with another item
  if (updateData.serial_number && updateData.serial_number !== equipment.serial_number) {
    const existing = await models.Equipment.findOne({ where: { serial_number: updateData.serial_number } });
    if (existing) throw new AppError('Another item already uses this serial number.', 400);
  }

  await equipment.update(updateData);
  return equipment;
};

export const updateEquipmentStatus = async (models, equipmentId, newStatus) => {
  const validStatuses = ['Available', 'Rented', 'Maintenance', 'Retired'];
  if (!validStatuses.includes(newStatus)) {
    throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
  }

  const equipment = await getEquipmentById(models, equipmentId);
  equipment.status = newStatus;
  await equipment.save();
  return equipment;
};