import UserFactory from "./User.js";
import RoleFactory from "./Role.js";
import PermissionFactory from "./Permission.js";
import CustomerFactory from "./Customer.js";
import EquipmentFactory from "./Equipment.js";
import EquipmentCategoryFactory from "./EquipmentCategory.js";
import WarehouseFactory from "./Warehouse.js";
import InvoiceFactory from "./Invoice.js";
import InvoiceLineFactory from "./InvoiceLine.js";
import PaymentFactory from "./Payment.js";
import DefectLogFactory from "./DefectLog.js";
import InvoiceTraceFactory from "./InvoiceTrace.js";

export const initTenantModels = (tenantConnection) => {
  const User = UserFactory(tenantConnection);
  const Role = RoleFactory(tenantConnection);
  const Permission = PermissionFactory(tenantConnection);
  const Customer = CustomerFactory(tenantConnection);
  const Equipment = EquipmentFactory(tenantConnection);
  const EquipmentCategory = EquipmentCategoryFactory(tenantConnection);
  const Warehouse = WarehouseFactory(tenantConnection);
  const Invoice = InvoiceFactory(tenantConnection);
  const InvoiceLine = InvoiceLineFactory(tenantConnection);
  const Payment = PaymentFactory(tenantConnection);
  const DefectLog = DefectLogFactory(tenantConnection);
  const InvoiceTrace = InvoiceTraceFactory(tenantConnection);

  // ==========================================
  // AUTH & USERS
  // ==========================================

  // 1. Explicitly define junction models to disable automatic timestamps
  const UserRoles = tenantConnection.define(
    "USER_ROLES",
    {},
    { timestamps: false },
  );
  const RolePermissions = tenantConnection.define(
    "ROLE_PERMISSIONS",
    {},
    { timestamps: false },
  );

  // 2. Map the relationships using the explicitly defined models
  User.belongsToMany(Role, { through: UserRoles, foreignKey: "user_id" });
  Role.belongsToMany(User, { through: UserRoles, foreignKey: "role_id" });

  Role.belongsToMany(Permission, {
    through: RolePermissions,
    foreignKey: "role_id",
  });
  Permission.belongsToMany(Role, {
    through: RolePermissions,
    foreignKey: "permission_id",
  });

  User.belongsTo(Warehouse, { foreignKey: "warehouse_id" });
  Warehouse.hasMany(User, { foreignKey: "warehouse_id" });

  // INVENTORY
  Equipment.belongsTo(EquipmentCategory, { foreignKey: "category_id" });
  EquipmentCategory.hasMany(Equipment, { foreignKey: "category_id" });
  Equipment.belongsTo(Warehouse, { foreignKey: "warehouse_id" });
  Warehouse.hasMany(Equipment, { foreignKey: "warehouse_id" });

  // INVOICES & BILLING
  Invoice.belongsTo(Customer, { foreignKey: "customer_id" });
  Customer.hasMany(Invoice, { foreignKey: "customer_id" });
  Invoice.belongsTo(User, { foreignKey: "issued_by_user_id" });
  User.hasMany(Invoice, { foreignKey: "issued_by_user_id" });

  InvoiceLine.belongsTo(Invoice, { foreignKey: "invoice_id" });
  Invoice.hasMany(InvoiceLine, { foreignKey: "invoice_id" });
  InvoiceLine.belongsTo(Equipment, { foreignKey: "equipment_id" });
  Equipment.hasMany(InvoiceLine, { foreignKey: "equipment_id" });

  InvoiceLine.belongsTo(InvoiceLine, {
    as: "ParentLine",
    foreignKey: "parent_line_id",
  });
  InvoiceLine.hasMany(InvoiceLine, {
    as: "ChildLines",
    foreignKey: "parent_line_id",
  });

  Payment.belongsTo(Invoice, { foreignKey: "invoice_id" });
  Invoice.hasMany(Payment, { foreignKey: "invoice_id" });

  // LOGS & TRACES
  DefectLog.belongsTo(Equipment, { foreignKey: "equipment_id" });
  DefectLog.belongsTo(Invoice, { foreignKey: "reported_on_invoice_id" });
  InvoiceTrace.belongsTo(Invoice, { foreignKey: "invoice_id" });
  InvoiceTrace.belongsTo(User, { foreignKey: "actor_user_id" });

  return {
    User,
    Role,
    Permission,
    Customer,
    Equipment,
    EquipmentCategory,
    Warehouse,
    Invoice,
    InvoiceLine,
    Payment,
    DefectLog,
    InvoiceTrace,
    sequelize: tenantConnection,
  };
};
