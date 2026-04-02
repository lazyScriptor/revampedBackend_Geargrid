import { DataTypes } from "sequelize";

export default (sequelize) => {
  const InvoiceTrace = sequelize.define(
    "InvoiceTrace",
    {
      trace_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      invoice_id: { type: DataTypes.INTEGER, allowNull: false },
      actor_user_id: { type: DataTypes.INTEGER, allowNull: true },
      event_category: { type: DataTypes.STRING(50), allowNull: false },
      event_action: { type: DataTypes.STRING(50), allowNull: false },
      entity_reference_id: { type: DataTypes.STRING(36), allowNull: true },
      state_payload: { type: DataTypes.JSON, allowNull: true },
      comments: { type: DataTypes.TEXT, allowNull: true },
      occurred_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "INVOICE_TRACE",
      timestamps: false,
    },
  );
  return InvoiceTrace;
};
