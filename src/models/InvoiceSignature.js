import { DataTypes } from "sequelize";

export default (sequelize) => {
  const InvoiceSignature = sequelize.define(
    "InvoiceSignature",
    {
      signature_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      invoice_id: { type: DataTypes.INTEGER, allowNull: false },
      signature_request_id: { type: DataTypes.INTEGER, allowNull: true },
      checkpoint: {
        type: DataTypes.ENUM(
          "DEPOSIT_COLLECTED",
          "EQUIPMENT_DISPATCHED",
          "EQUIPMENT_RETURNED",
          "PAYMENT_RECEIVED",
          "OTHER",
        ),
        allowNull: false,
        defaultValue: "OTHER",
      },
      signatory_role: {
        type: DataTypes.ENUM("CUSTOMER", "OPERATOR", "GUARANTOR", "WITNESS"),
        allowNull: false,
      },
      signatory_name: { type: DataTypes.STRING(150), allowNull: false },
      // Non-null only when the signatory is a known USER (e.g. OPERATOR using
      // their saved signature). CUSTOMER signatures leave this null.
      signatory_user_id: { type: DataTypes.INTEGER, allowNull: true },
      // Public URL path (e.g. /uploads/signatures/<tenant>/<invoice>/<id>.png).
      image_url: { type: DataTypes.STRING(500), allowNull: false },
      // SHA-256 of the raw PNG bytes — tamper-detection + duplicate detection.
      image_sha256: { type: DataTypes.STRING(64), allowNull: true },
      source: {
        type: DataTypes.ENUM(
          "PHONE_CANVAS",
          "POS_CANVAS",
          "STORED_OPERATOR_SIG",
        ),
        allowNull: false,
        defaultValue: "PHONE_CANVAS",
      },
      captured_from_ip: { type: DataTypes.STRING(45), allowNull: true },
      captured_from_user_agent: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      terms_version_signed: { type: DataTypes.INTEGER, allowNull: true },
      captured_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "INVOICE_SIGNATURES",
      timestamps: true,
      indexes: [
        { fields: ["invoice_id"] },
        { fields: ["signature_request_id"] },
        { fields: ["signatory_user_id"] },
        { fields: ["captured_at"] },
      ],
    },
  );
  return InvoiceSignature;
};
