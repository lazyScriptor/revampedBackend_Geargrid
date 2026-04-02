import AppError from '../utils/AppError.js';

export const createWarehouse = async (models, locationName, address, managerUserId = null) => {
  return await models.Warehouse.create({
    location_name: locationName,
    address: address,
    manager_user_id: managerUserId 
  });
};

export const getAllWarehouses = async (models) => {
  return await models.Warehouse.findAll({
    include: [{
      model: models.User, // If you linked a manager, this pulls their info
      attributes: ['first_name', 'last_name', 'email']
    }]
  });
};