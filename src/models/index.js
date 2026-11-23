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
import ExpenseAuditFactory from "./ExpenseAudit.js";
import UserPermissionOverrideFactory from "./UserPermissionOverride.js";
import DashboardTemplateFactory from "./DashboardTemplate.js";
import UserDashboardPreferenceFactory from "./UserDashboardPreference.js";
import NotificationFactory from "./Notification.js";
import BulkJobFactory from "./BulkJob.js";
import InvoicePrintLogFactory from "./InvoicePrintLog.js";
import SignatureRequestFactory from "./SignatureRequest.js";
import InvoiceSignatureFactory from "./InvoiceSignature.js";
import OperatorDeviceFactory from "./OperatorDevice.js";
import WhatsappMessageLogFactory from "./WhatsappMessageLog.js";
import WhatsappTemplateFactory from "./WhatsappTemplate.js";
import PhotoRequestFactory from "./PhotoRequest.js";
import CashLockerCountFactory from "./CashLockerCount.js";
import CustomerPhoneFactory from "./CustomerPhone.js";
import PhoneContactFactory from "./PhoneContact.js";
import PushPreferenceFactory from "./PushPreference.js";
import CallLogFactory from "./CallLog.js";
import CallNoteFactory from "./CallNote.js";
import DeviceAuditLogFactory from "./DeviceAuditLog.js";
import PushTemplateFactory from "./PushTemplate.js";
import CounterExceptionFactory from "./CounterException.js";
import ApprovalTokenFactory from "./ApprovalToken.js";
import IdempotencyKeyFactory from "./IdempotencyKey.js";
import UserUiPreferenceFactory from "./UserUiPreference.js";
import RetailCategoryFactory from "./RetailCategory.js";
import RetailBrandFactory from "./RetailBrand.js";
import RetailFamilyFactory from "./RetailFamily.js";
import RetailProductFactory from "./RetailProduct.js";
import RetailProductUnitFactory from "./RetailProductUnit.js";
import RetailBarcodeFactory from "./RetailBarcode.js";
import RetailSearchAliasFactory from "./RetailSearchAlias.js";
import RetailStockLevelFactory from "./RetailStockLevel.js";
import RetailStockDocumentFactory from "./RetailStockDocument.js";
import RetailStockDocumentLineFactory from "./RetailStockDocumentLine.js";
import RetailStockMovementFactory from "./RetailStockMovement.js";
import RetailSerialFactory from "./RetailSerial.js";

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
  const ExpenseAudit = ExpenseAuditFactory(tenantConnection);
  const UserPermissionOverride = UserPermissionOverrideFactory(tenantConnection);
  const DashboardTemplate = DashboardTemplateFactory(tenantConnection);
  const UserDashboardPreference = UserDashboardPreferenceFactory(tenantConnection);
  const Notification = NotificationFactory(tenantConnection);
  const BulkJob = BulkJobFactory(tenantConnection);
  const InvoicePrintLog = InvoicePrintLogFactory(tenantConnection);
  const SignatureRequest = SignatureRequestFactory(tenantConnection);
  const InvoiceSignature = InvoiceSignatureFactory(tenantConnection);
  const OperatorDevice = OperatorDeviceFactory(tenantConnection);
  const WhatsappMessageLog = WhatsappMessageLogFactory(tenantConnection);
  const WhatsappTemplate = WhatsappTemplateFactory(tenantConnection);
  const PhotoRequest = PhotoRequestFactory(tenantConnection);
  const CashLockerCount = CashLockerCountFactory(tenantConnection);
  const CustomerPhone = CustomerPhoneFactory(tenantConnection);
  const PhoneContact = PhoneContactFactory(tenantConnection);
  const PushPreference = PushPreferenceFactory(tenantConnection);
  const CallLog = CallLogFactory(tenantConnection);
  const CallNote = CallNoteFactory(tenantConnection);
  const DeviceAuditLog = DeviceAuditLogFactory(tenantConnection);
  const PushTemplate = PushTemplateFactory(tenantConnection);
  const CounterException = CounterExceptionFactory(tenantConnection);
  const ApprovalToken = ApprovalTokenFactory(tenantConnection);
  const IdempotencyKey = IdempotencyKeyFactory(tenantConnection);
  const UserUiPreference = UserUiPreferenceFactory(tenantConnection);
  const RetailCategory = RetailCategoryFactory(tenantConnection);
  const RetailBrand = RetailBrandFactory(tenantConnection);
  const RetailFamily = RetailFamilyFactory(tenantConnection);
  const RetailProduct = RetailProductFactory(tenantConnection);
  const RetailProductUnit = RetailProductUnitFactory(tenantConnection);
  const RetailBarcode = RetailBarcodeFactory(tenantConnection);
  const RetailSearchAlias = RetailSearchAliasFactory(tenantConnection);
  const RetailStockLevel = RetailStockLevelFactory(tenantConnection);
  const RetailStockDocument = RetailStockDocumentFactory(tenantConnection);
  const RetailStockDocumentLine = RetailStockDocumentLineFactory(tenantConnection);
  const RetailStockMovement = RetailStockMovementFactory(tenantConnection);
  const RetailSerial = RetailSerialFactory(tenantConnection);

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
  Customer.hasMany(CustomerPhone, { foreignKey: "customer_id" });
  CustomerPhone.belongsTo(Customer, { foreignKey: "customer_id" });

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
  Payment.belongsTo(User, { foreignKey: "received_by_user_id" });
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
  // NOTIFICATIONS & BULK JOBS & PRINT LOGS
  // ==========================================
  Notification.belongsTo(User, { foreignKey: "user_id" });
  User.hasMany(Notification, { foreignKey: "user_id" });

  BulkJob.belongsTo(User, { foreignKey: "user_id" });
  User.hasMany(BulkJob, { foreignKey: "user_id" });

  InvoicePrintLog.belongsTo(User, { as: "PrintedBy", foreignKey: "printed_by_user_id" });
  User.hasMany(InvoicePrintLog, { foreignKey: "printed_by_user_id" });

  InvoicePrintLog.belongsTo(Invoice, { foreignKey: "invoice_id" });
  Invoice.hasMany(InvoicePrintLog, { as: "PrintLogs", foreignKey: "invoice_id" });

  // ── Signature capture subsystem associations ───────────────────────────
  PhotoRequest.belongsTo(Equipment, { foreignKey: "equipment_id" });
  SignatureRequest.belongsTo(Invoice, { foreignKey: "invoice_id" });
  Invoice.hasMany(SignatureRequest, { as: "SignatureRequests", foreignKey: "invoice_id" });
  SignatureRequest.belongsTo(User, { as: "RequestedBy", foreignKey: "requested_by_user_id" });
  SignatureRequest.hasMany(InvoiceSignature, { as: "Signatures", foreignKey: "signature_request_id" });

  InvoiceSignature.belongsTo(Invoice, { foreignKey: "invoice_id" });
  Invoice.hasMany(InvoiceSignature, { as: "Signatures", foreignKey: "invoice_id" });
  InvoiceSignature.belongsTo(SignatureRequest, { foreignKey: "signature_request_id" });
  InvoiceSignature.belongsTo(User, { as: "SignatoryUser", foreignKey: "signatory_user_id" });

  // ── Paired-PWA signature-capture devices ──────────────────────────────
  OperatorDevice.belongsTo(User, { foreignKey: "user_id" });
  User.hasMany(OperatorDevice, { foreignKey: "user_id" });
  OperatorDevice.hasMany(DeviceAuditLog, { foreignKey: "operator_device_id" });
  DeviceAuditLog.belongsTo(OperatorDevice, { foreignKey: "operator_device_id" });
  DeviceAuditLog.belongsTo(User, { as: "Actor", foreignKey: "actor_user_id" });

  // ── Phone Assistant contacts ──
  OperatorDevice.hasMany(PhoneContact, { foreignKey: "operator_device_id" });
  PhoneContact.belongsTo(OperatorDevice, { foreignKey: "operator_device_id" });
  PhoneContact.belongsTo(Customer, { as: "LinkedCustomer", foreignKey: "linked_customer_id" });
  PhoneContact.belongsTo(User, { as: "LastUsedBy", foreignKey: "last_used_by_user_id" });
  Customer.belongsTo(PhoneContact, { as: "SourceContact", foreignKey: "source_contact_id" });

  // ── Phone Assistant push preferences ──
  User.hasMany(PushPreference, { foreignKey: "user_id" });
  PushPreference.belongsTo(User, { foreignKey: "user_id" });

  // ── Phone Assistant call logs & notes ──
  CallLog.belongsTo(OperatorDevice, { foreignKey: "operator_device_id" });
  OperatorDevice.hasMany(CallLog, { foreignKey: "operator_device_id" });
  CallLog.belongsTo(Customer, { foreignKey: "customer_id" });
  Customer.hasMany(CallLog, { foreignKey: "customer_id" });
  CallLog.belongsTo(PhoneContact, { foreignKey: "contact_id" });
  PhoneContact.hasMany(CallLog, { foreignKey: "contact_id" });
  CallLog.hasMany(CallNote, { foreignKey: "call_id", onDelete: "CASCADE" });
  CallNote.belongsTo(CallLog, { foreignKey: "call_id" });
  Customer.hasMany(CallNote, { foreignKey: "customer_id", onDelete: "SET NULL" });
  CallNote.belongsTo(Customer, { foreignKey: "customer_id" });
  PhoneContact.hasMany(CallNote, { foreignKey: "contact_id", onDelete: "SET NULL" });
  CallNote.belongsTo(PhoneContact, { foreignKey: "contact_id" });
  User.hasMany(CallNote, { foreignKey: "created_by_user_id", onDelete: "SET NULL" });
  CallNote.belongsTo(User, { as: "Author", foreignKey: "created_by_user_id" });

  // ── Cash locker ──
  CashLockerCount.belongsTo(User, { as: "CountedBy", foreignKey: "counted_by_user_id" });
  CashLockerCount.belongsTo(User, { as: "ReviewedBy", foreignKey: "reviewed_by_user_id" });

  // ── Retail POS foundations (R0): counter exceptions & approvals ──
  CounterException.belongsTo(User, { as: "Requester", foreignKey: "requested_by" });
  CounterException.belongsTo(User, { as: "Approver", foreignKey: "approved_by" });
  ApprovalToken.belongsTo(CounterException, { foreignKey: "exception_id" });
  CounterException.hasMany(ApprovalToken, { foreignKey: "exception_id" });
  UserUiPreference.belongsTo(User, { foreignKey: "user_id" });

  // ── Retail POS catalogue (R1) ──
  RetailCategory.belongsTo(RetailCategory, { as: "Parent", foreignKey: "parent_id" });
  RetailCategory.hasMany(RetailCategory, { as: "Children", foreignKey: "parent_id" });

  RetailFamily.belongsTo(RetailCategory, { foreignKey: "category_id" });
  RetailCategory.hasMany(RetailFamily, { foreignKey: "category_id" });
  RetailFamily.belongsTo(RetailBrand, { foreignKey: "brand_id" });
  RetailBrand.hasMany(RetailFamily, { foreignKey: "brand_id" });

  RetailProduct.belongsTo(RetailFamily, { foreignKey: "family_id" });
  RetailFamily.hasMany(RetailProduct, { foreignKey: "family_id" });
  RetailProduct.belongsTo(RetailCategory, { foreignKey: "category_id" });
  RetailCategory.hasMany(RetailProduct, { foreignKey: "category_id" });
  RetailProduct.belongsTo(RetailBrand, { foreignKey: "brand_id" });
  RetailBrand.hasMany(RetailProduct, { foreignKey: "brand_id" });

  RetailProduct.hasMany(RetailProductUnit, {
    as: "Units",
    foreignKey: "product_id",
    onDelete: "CASCADE",
  });
  RetailProductUnit.belongsTo(RetailProduct, { foreignKey: "product_id" });

  RetailProduct.hasMany(RetailBarcode, {
    as: "Barcodes",
    foreignKey: "product_id",
    onDelete: "CASCADE",
  });
  RetailBarcode.belongsTo(RetailProduct, { foreignKey: "product_id" });
  RetailBarcode.belongsTo(RetailProductUnit, { as: "Unit", foreignKey: "unit_id" });

  // ── Retail POS stock & movements (R2) ──
  RetailStockLevel.belongsTo(RetailProduct, { foreignKey: "product_id" });
  RetailProduct.hasMany(RetailStockLevel, { as: "StockLevels", foreignKey: "product_id" });
  RetailStockLevel.belongsTo(Warehouse, { foreignKey: "warehouse_id" });
  Warehouse.hasMany(RetailStockLevel, { foreignKey: "warehouse_id" });

  RetailStockDocument.belongsTo(Warehouse, { as: "Warehouse", foreignKey: "warehouse_id" });
  RetailStockDocument.belongsTo(Warehouse, { as: "ToWarehouse", foreignKey: "to_warehouse_id" });
  RetailStockDocument.belongsTo(User, { as: "User", foreignKey: "user_id" });
  RetailStockDocument.hasMany(RetailStockDocumentLine, {
    as: "Lines",
    foreignKey: "doc_id",
    onDelete: "CASCADE",
  });
  RetailStockDocumentLine.belongsTo(RetailStockDocument, { as: "Document", foreignKey: "doc_id" });
  RetailStockDocumentLine.belongsTo(RetailProduct, { foreignKey: "product_id" });
  RetailStockDocumentLine.belongsTo(RetailProductUnit, { as: "Unit", foreignKey: "unit_id" });

  RetailStockMovement.belongsTo(RetailProduct, { foreignKey: "product_id" });
  RetailStockMovement.belongsTo(Warehouse, { foreignKey: "warehouse_id" });
  RetailStockMovement.belongsTo(RetailStockDocument, { as: "Document", foreignKey: "doc_id" });
  RetailStockMovement.belongsTo(User, { as: "User", foreignKey: "user_id" });

  RetailSerial.belongsTo(RetailProduct, { foreignKey: "product_id" });
  RetailSerial.belongsTo(Warehouse, { foreignKey: "warehouse_id" });
  RetailSerial.belongsTo(RetailStockDocument, { as: "ReceiveDoc", foreignKey: "receive_doc_id" });

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
    ExpenseAudit,
    UserPermissionOverride,
    DashboardTemplate,
    UserDashboardPreference,
    Notification,
    BulkJob,
    InvoicePrintLog,
    SignatureRequest,
    InvoiceSignature,
    OperatorDevice,
    WhatsappMessageLog,
    WhatsappTemplate,
    PhotoRequest,
    CashLockerCount,
    CustomerPhone,
    PhoneContact,
    PushPreference,
    CallLog,
    CallNote,
    DeviceAuditLog,
    PushTemplate,
    CounterException,
    ApprovalToken,
    IdempotencyKey,
    UserUiPreference,
    RetailCategory,
    RetailBrand,
    RetailFamily,
    RetailProduct,
    RetailProductUnit,
    RetailBarcode,
    RetailSearchAlias,
    RetailStockLevel,
    RetailStockDocument,
    RetailStockDocumentLine,
    RetailStockMovement,
    RetailSerial,
    sequelize: tenantConnection,
  };
};
