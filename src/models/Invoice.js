import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Invoice = sequelize.define(
    "Invoice",
    {
      invoice_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      customer_id: { type: DataTypes.INTEGER, allowNull: false },
      issued_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
      total_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      advance_paid: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      id_card_status: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 0,
      },
      number_of_days_of_the_bill: { type: DataTypes.INTEGER, allowNull: false },
      status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "Active",
      },
      issued_date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "INVOICES",
      timestamps: false,
    },
  );
  return Invoice;
};
