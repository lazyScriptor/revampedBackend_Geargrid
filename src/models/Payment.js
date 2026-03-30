import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Payment = sequelize.define(
    "Payment",
    {
      payment_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      invoice_id: { type: DataTypes.UUID, allowNull: false },
      payment_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      payment_date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      method: { type: DataTypes.STRING(50), allowNull: false },
    },
    {
      tableName: "PAYMENTS",
      timestamps: false,
    },
  );
  return Payment;
};
