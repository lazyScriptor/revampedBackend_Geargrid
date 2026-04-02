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
      defective_quantity: { type: DataTypes.INTEGER, allowNull: false },
      defect_description: { type: DataTypes.TEXT, allowNull: false },
      repair_status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "Reported",
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
