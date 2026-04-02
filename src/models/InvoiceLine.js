import { DataTypes } from "sequelize";

export default (sequelize) => {
  const InvoiceLine = sequelize.define(
    "InvoiceLine",
    {
      line_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      invoice_id: { type: DataTypes.INTEGER, allowNull: false },
      equipment_id: { type: DataTypes.INTEGER, allowNull: false },
      parent_line_id: { type: DataTypes.INTEGER, allowNull: true },
      borrow_date: { type: DataTypes.DATEONLY, allowNull: false },
      expected_return_date: { type: DataTypes.DATEONLY, allowNull: false },
      actual_return_date: { type: DataTypes.DATEONLY, allowNull: true },
      locked_base_price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      locked_minimum_days: { type: DataTypes.INTEGER, allowNull: false },
      locked_extra_daily_rate: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      line_total_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      borrow_quantity: { type: DataTypes.INTEGER, allowNull: false },
      good_returned_qty: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      defective_returned_qty: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      line_status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "Active",
      },
    },
    {
      tableName: "INVOICE_LINES",
      timestamps: false,
    },
  );
  return InvoiceLine;
};
