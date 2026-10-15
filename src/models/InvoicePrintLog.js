import { DataTypes } from "sequelize";

export default (sequelize) => {
  const InvoicePrintLog = sequelize.define(
    "InvoicePrintLog",
    {
      log_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      invoice_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      doc_number: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      doc_type: {
        type: DataTypes.ENUM("DISPATCH", "COMPLETED", "DRAFT", "RETURN_SETTLEMENT"),
        defaultValue: "DISPATCH",
        allowNull: false,
      },
      printed_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      printed_by_name: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      printed_by_role: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      customer_name: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      customer_phone: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      print_method: {
        type: DataTypes.ENUM("direct_agent", "browser_dialog"),
        defaultValue: "direct_agent",
        allowNull: false,
      },
      printer_name: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      paper_width: {
        type: DataTypes.STRING(10),
        defaultValue: "80mm",
      },
      copies: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
      },
      height_mm: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      total_items: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      total_machines: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      subtotal: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0.0,
      },
      transport_fee: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0.0,
      },
      discount_amount: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0.0,
      },
      grand_total: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0.0,
      },
      total_paid: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0.0,
      },
      balance_due: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0.0,
      },
      language: {
        type: DataTypes.STRING(10),
        defaultValue: "en",
      },
      custom_notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      bill_snapshot: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      ip_address: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      printed_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false,
      },
    },
    {
      tableName: "INVOICE_PRINT_LOGS",
      timestamps: true,
      indexes: [
        { fields: ["invoice_id"] },
        { fields: ["printed_by_user_id"] },
        { fields: ["doc_number"] },
        { fields: ["printed_at"] },
      ],
    }
  );

  return InvoicePrintLog;
};
