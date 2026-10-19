import { DataTypes } from "sequelize";

export default (sequelize) => {
  const SignatureRequest = sequelize.define(
    "SignatureRequest",
    {
      request_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      invoice_id: { type: DataTypes.INTEGER, allowNull: false },
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
      // Array of SignatureRole values. Stored as JSON because the set is
      // small, bounded (max 4), and queried only by the row itself.
      required_roles: { type: DataTypes.JSON, allowNull: false },
      token: { type: DataTypes.STRING(80), allowNull: false, unique: true },
      requested_by_user_id: { type: DataTypes.INTEGER, allowNull: false },
      status: {
        type: DataTypes.ENUM(
          "PENDING",
          "PARTIAL",
          "COMPLETED",
          "EXPIRED",
          "CANCELLED",
        ),
        allowNull: false,
        defaultValue: "PENDING",
      },
      expires_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      tableName: "SIGNATURE_REQUESTS",
      timestamps: true,
      indexes: [
        { fields: ["invoice_id"] },
        { fields: ["status"] },
        { fields: ["expires_at"] },
      ],
    },
  );
  return SignatureRequest;
};
