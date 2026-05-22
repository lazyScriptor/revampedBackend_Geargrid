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
import InvoiceReviewFactory from "./InvoiceReview.js";
import TenantConfigFactory from "./TenantConfig.js";
import ExpenseFactory from "./Expense.js";
import UserPermissionOverrideFactory from "./UserPermissionOverride.js";
import DashboardTemplateFactory from "./DashboardTemplate.js";
import UserDashboardPreferenceFactory from "./UserDashboardPreference.js";
import NotificationFactory from "./Notification.js";
import BulkJobFactory from "./BulkJob.js";

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
  const InvoiceReview = InvoiceReviewFactory(tenantConnection);
  const TenantConfig = TenantConfigFactory(tenantConnection);
  const Expense = ExpenseFactory(tenantConnection);
  const UserPermissionOverride = UserPermissionOverrideFactory(tenantConnection);
  const DashboardTemplate = DashboardTemplateFactory(tenantConnection);
  const UserDashboardPreference = UserDashboardPreferenceFactory(tenantConnection);
  const Notification = NotificationFactory(tenantConnection);
  const BulkJob = BulkJobFactory(tenantConnection);

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

  Customer.belongsTo(Customer, {
    as: "ParentCompany",
    foreignKey: "parent_customer_id",
  });
  Customer.hasMany(Customer, {
    as: "Workers",
    foreignKey: "parent_customer_id",
  });

  // INVOICES & BILLING
  Invoice.belongsTo(Customer, { foreignKey: "customer_id" });
  Customer.hasMany(Invoice, { foreignKey: "customer_id" });
  // Secondary attribution — who the invoice was rented on behalf of (optional).
  Invoice.belongsTo(Customer, {
    as: "OnBehalfOfCustomer",
    foreignKey: "borrowed_on_behalf_of_customer_id",
  });
  Customer.hasMany(Invoice, {
    as: "InvoicesAsBeneficiary",
    foreignKey: "borrowed_on_behalf_of_customer_id",
  });
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
  // LOGS & TRACES
  DefectLog.belongsTo(Equipment, { foreignKey: "equipment_id" });
  Equipment.hasMany(DefectLog, { foreignKey: "equipment_id" }); // <-- NEW

  DefectLog.belongsTo(Invoice, { foreignKey: "reported_on_invoice_id" });
  Invoice.hasMany(DefectLog, { foreignKey: "reported_on_invoice_id" }); // <-- NEW

  // Add this near your other DefectLog relations
  DefectLog.belongsTo(User, {
    as: "Technician",
    foreignKey: "assigned_technician_id",
  });
  User.hasMany(DefectLog, { foreignKey: "assigned_technician_id" });

  InvoiceTrace.belongsTo(Invoice, { foreignKey: "invoice_id" });
  Invoice.hasMany(InvoiceTrace, { foreignKey: "invoice_id" }); // <-- CRITICAL FIX

  InvoiceTrace.belongsTo(User, { foreignKey: "actor_user_id" });
  User.hasMany(InvoiceTrace, { foreignKey: "actor_user_id" }); // <-- NEW

  // INVOICE REVIEWS — staff-authored per-invoice ratings + comments.
  InvoiceReview.belongsTo(Invoice, { foreignKey: "invoice_id" });
  Invoice.hasMany(InvoiceReview, { foreignKey: "invoice_id" });
  InvoiceReview.belongsTo(Customer, { foreignKey: "customer_id" });
  Customer.hasMany(InvoiceReview, { foreignKey: "customer_id" });
  InvoiceReview.belongsTo(User, { as: "Author", foreignKey: "author_user_id" });
  User.hasMany(InvoiceReview, { as: "AuthoredReviews", foreignKey: "author_user_id" });

  // EXPENSES
  Expense.belongsTo(User, { foreignKey: "recorded_by_user_id" });
  User.hasMany(Expense, { foreignKey: "recorded_by_user_id" });
  Expense.belongsTo(Warehouse, { foreignKey: "warehouse_id" });
  Warehouse.hasMany(Expense, { foreignKey: "warehouse_id" });

  // USER PERMISSION OVERRIDES (Fine-grained per-user grants/revokes)
  UserPermissionOverride.belongsTo(User, { foreignKey: "user_id" });
  User.hasMany(UserPermissionOverride, { foreignKey: "user_id" });
  UserPermissionOverride.belongsTo(Permission, { foreignKey: "permission_id" });
  Permission.hasMany(UserPermissionOverride, { foreignKey: "permission_id" });

  // DASHBOARD
  DashboardTemplate.belongsTo(Role, { foreignKey: "role_id", required: false });
  Role.hasMany(DashboardTemplate, { foreignKey: "role_id" });
  DashboardTemplate.belongsTo(User, { as: "Creator", foreignKey: "created_by_user_id" });

  UserDashboardPreference.belongsTo(User, { foreignKey: "user_id" });
  User.hasOne(UserDashboardPreference, { foreignKey: "user_id" });

  // ==========================================
  // NOTIFICATIONS & BULK JOBS
  // ==========================================
  Notification.belongsTo(User, { foreignKey: "user_id" });
  User.hasMany(Notification, { foreignKey: "user_id" });

  BulkJob.belongsTo(User, { foreignKey: "user_id" });
  User.hasMany(BulkJob, { foreignKey: "user_id" });

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
    InvoiceReview,
    TenantConfig,
    Expense,
    UserPermissionOverride,
    DashboardTemplate,
    UserDashboardPreference,
    Notification,
    BulkJob,
    sequelize: tenantConnection,
  };
};
