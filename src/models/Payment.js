import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Payment = sequelize.define(
    "Payment",
    {
      payment_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      invoice_id: { type: DataTypes.INTEGER, allowNull: false },
      payment_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      payment_date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      method: { type: DataTypes.STRING(50), allowNull: false },
      // Set when the parent invoice is deleted: excluded from revenue but kept for reconciliation.
      is_voided: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      voided_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "PAYMENTS",
      timestamps: false,
      defaultScope: { where: { is_voided: false } },
    },
  );
  return Payment;
};
