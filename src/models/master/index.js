import SuperAdminFactory from "./SuperAdmin.js";
import TenantFactory from "./Tenant.js";
import GlobalUserFactory from "./GlobalUser.js";
import AuditLogFactory from "./AuditLog.js";
import TenantSubscriptionFactory from "./TenantSubscription.js";
import PlatformConfigFactory from "./PlatformConfig.js";

let masterModels = null;

export const initMasterModels = (masterSequelize) => {
  if (masterModels) return masterModels;

  const SuperAdmin = SuperAdminFactory(masterSequelize);
  const Tenant = TenantFactory(masterSequelize);
  const GlobalUser = GlobalUserFactory(masterSequelize);
  const AuditLog = AuditLogFactory(masterSequelize);
  const TenantSubscription = TenantSubscriptionFactory(masterSequelize);
  const PlatformConfig = PlatformConfigFactory(masterSequelize);

  // Associations
  Tenant.hasMany(GlobalUser, { foreignKey: "target_tenant_id" });
  GlobalUser.belongsTo(Tenant, { foreignKey: "target_tenant_id" });

  AuditLog.belongsTo(SuperAdmin, { foreignKey: "super_admin_id" });
  SuperAdmin.hasMany(AuditLog, { foreignKey: "super_admin_id" });

  Tenant.hasMany(TenantSubscription, { foreignKey: "tenant_id" });
  TenantSubscription.belongsTo(Tenant, { foreignKey: "tenant_id" });

  masterModels = {
    SuperAdmin,
    Tenant,
    GlobalUser,
    AuditLog,
    TenantSubscription,
    PlatformConfig,
    sequelize: masterSequelize,
  };

  return masterModels;
};

export const getMasterModels = () => {
  if (!masterModels) {
    throw new Error(
      "Master models not initialized. Call initMasterModels() first.",
    );
  }
  return masterModels;
};
