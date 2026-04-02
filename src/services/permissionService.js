// Permissions are usually hardcoded by you (the developer) and synced to the DB.
// Clients shouldn't create new permissions, only assign existing ones to roles.
export const getAllPermissions = async (models) => {
  return await models.Permission.findAll({
    order: [['module_name', 'ASC']] 
  });
};