import AppError from '../utils/AppError.js';

export const getAllUsers = async (models) => {
  return await models.User.findAll({
    attributes: { exclude: ['password_hash'] }, // Never send passwords to the frontend!
    include: [{
      model: models.Role,
      attributes: ['role_id', 'role_name'],
      through: { attributes: [] } // Hides the junction table data
    }, {
      model: models.Warehouse,
      attributes: ['warehouse_id', 'location_name']
    }]
  });
};

export const updateUserStatus = async (models, userId, isActive) => {
  const user = await models.User.findByPk(userId);
  if (!user) throw new AppError('User not found.', 404);

  user.is_active = isActive;
  await user.save();
  return user;
};

export const assignUserRoles = async (models, userId, roleIds) => {
  const user = await models.User.findByPk(userId);
  if (!user) throw new AppError('User not found.', 404);

  // roleIds should be an array of UUIDs: ['uuid-1', 'uuid-2']
  // This automatically wipes old roles and sets the new ones in USER_ROLES
  await user.setRoles(roleIds); 
  
  return await models.User.findByPk(userId, {
    attributes: { exclude: ['password_hash'] },
    include: [{ model: models.Role, attributes: ['role_name'] }]
  });
};