import { DataTypes } from "sequelize";

export default (sequelize) => {
  const DefectLog = sequelize.define(
    "DefectLog",
    {
      log_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      equipment_id: { type: DataTypes.INTEGER, allowNull: false },
      reported_on_invoice_id: { type: DataTypes.INTEGER, allowNull: true },
      assigned_technician_id: { type: DataTypes.INTEGER, allowNull: true }, // NEW: Links to Users table

      // ENTERPRISE QUANTITY TRACKING
      defective_quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: "Total initially reported broken",
      },
      pending_quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: "Amount still waiting to be fixed",
      },
      repaired_quantity: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: "Amount already fixed and returned to shelf",
      },

      defect_description: { type: DataTypes.TEXT, allowNull: false },
      repair_status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "Pending Assignment", // Enterprise Statuses: 'Pending Assignment', 'In Repair', 'Partially Resolved', 'Resolved'
      },
      reported_date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      resolved_date: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "DEFECT_LOGS",
      timestamps: false,
    },
  );
  return DefectLog;
};
