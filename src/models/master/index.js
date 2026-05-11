import SuperAdminFactory from "./SuperAdmin.js";
import TenantFactory from "./Tenant.js";
import GlobalUserFactory from "./GlobalUser.js";
import AuditLogFactory from "./AuditLog.js";

let masterModels = null;

export const initMasterModels = (masterSequelize) => {
  // Return cached models if already initialized
  if (masterModels) return masterModels;

  const SuperAdmin = SuperAdminFactory(masterSequelize);
  const Tenant = TenantFactory(masterSequelize);
  const GlobalUser = GlobalUserFactory(masterSequelize);
  const AuditLog = AuditLogFactory(masterSequelize);

  // Associations
  Tenant.hasMany(GlobalUser, { foreignKey: "target_tenant_id" });
  GlobalUser.belongsTo(Tenant, { foreignKey: "target_tenant_id" });

  AuditLog.belongsTo(SuperAdmin, { foreignKey: "super_admin_id" });
  SuperAdmin.hasMany(AuditLog, { foreignKey: "super_admin_id" });

  masterModels = {
    SuperAdmin,
    Tenant,
    GlobalUser,
    AuditLog,
    sequelize: masterSequelize,
  };

  return masterModels;
};

// Convenience getter for use in services/controllers
export const getMasterModels = () => {
  if (!masterModels) {
    throw new Error("Master models not initialized. Call initMasterModels() first.");
  }
  return masterModels;
};
