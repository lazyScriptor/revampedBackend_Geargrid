import { DataTypes } from "sequelize";

export default (sequelize) =>
  sequelize.define(
    "ExpenseAudit",
    {
      audit_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      expense_id: { type: DataTypes.INTEGER, allowNull: false },
      action: { type: DataTypes.STRING(20), allowNull: false },
      actor_user_id: { type: DataTypes.INTEGER, allowNull: true },
      snapshot: { type: DataTypes.JSON, allowNull: true },
    },
    { tableName: "EXPENSE_AUDIT", timestamps: true, updatedAt: false },
  );
