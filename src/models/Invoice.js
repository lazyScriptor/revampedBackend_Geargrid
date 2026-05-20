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
      // Optional secondary attribution: the person physically taking the
      // equipment is `customer_id`; if they are renting it on behalf of a
      // family member / company, that parent customer goes here. Both rows
      // appear in either customer's rental history.
      borrowed_on_behalf_of_customer_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
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
      transport_fee: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      discount_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      sub_total: {
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
