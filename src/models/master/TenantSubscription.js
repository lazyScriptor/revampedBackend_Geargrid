import { DataTypes } from "sequelize";

export default (sequelize) => {
  const TenantSubscription = sequelize.define(
    "TenantSubscription",
    {
      sub_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      tenant_id: {
        type: DataTypes.STRING(36),
        allowNull: false,
      },
      plan_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        defaultValue: "Monthly",
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      currency: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: "LKR",
      },
      status: {
        type: DataTypes.ENUM("Paid", "Pending", "Overdue", "Refunded"),
        allowNull: false,
        defaultValue: "Pending",
      },
      billing_period_start: { type: DataTypes.DATEONLY, allowNull: true },
      billing_period_end: { type: DataTypes.DATEONLY, allowNull: true },
      paid_at: { type: DataTypes.DATE, allowNull: true },
      method: { type: DataTypes.STRING(100), allowNull: true },
      reference_number: { type: DataTypes.STRING(255), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "TENANT_SUBSCRIPTIONS",
      timestamps: true,
    },
  );
  return TenantSubscription;
};
