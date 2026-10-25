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
      // Who took the money (cashier accountability)
      received_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
      // Set when the parent invoice is deleted: excluded from revenue but kept for reconciliation.
      is_voided: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      voided_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "PAYMENTS",
      timestamps: false,
      // NOTE: deliberately NO defaultScope here — a scope `where` makes every `include: Payment`
      // an INNER JOIN and hides invoices with no payments. Voided payments only ever belong to
      // deleted invoices (already excluded); direct Payment queries filter is_voided explicitly.
    },
  );
  return Payment;
};
