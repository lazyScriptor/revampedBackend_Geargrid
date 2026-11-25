import { DataTypes } from "sequelize";

export const ACTIVITY_EVENT_TYPES = [
  "invoice_created",
  "payment",
  "refund",
  "discount",
  "backdated_payment",
  "backdated_bill",
  "backdated_return",
  "return",
  "payment_voided",
  "invoice_deleted",
  "invoice_restored",
  "invoice_reopened",
  "id_card_released_unpaid",
  "review",
  "customer_payment",
  "call_promise_missed",
  "system",
];

export const ACTIVITY_RISK_LEVELS = ["high", "normal"];

export default (sequelize) => {
  const ActivityEvent = sequelize.define(
    "ActivityEvent",
    {
      event_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      type: {
        type: DataTypes.ENUM(...ACTIVITY_EVENT_TYPES),
        allowNull: false,
        validate: {
          isIn: [ACTIVITY_EVENT_TYPES],
        },
      },
      risk: {
        type: DataTypes.ENUM(...ACTIVITY_RISK_LEVELS),
        allowNull: false,
        defaultValue: "normal",
        validate: {
          isIn: [ACTIVITY_RISK_LEVELS],
        },
      },
      invoice_id: { type: DataTypes.INTEGER, allowNull: true },
      customer_id: { type: DataTypes.INTEGER, allowNull: true },
      actor_user_id: { type: DataTypes.INTEGER, allowNull: true },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      data: { type: DataTypes.JSON, allowNull: true },
      occurred_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      after_hours: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      checked_by: { type: DataTypes.INTEGER, allowNull: true },
      checked_at: { type: DataTypes.DATE, allowNull: true },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "ACTIVITY_EVENTS",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
      indexes: [
        { fields: ["occurred_at"], name: "idx_activity_events_occurred_at" },
        { fields: ["type", "occurred_at"], name: "idx_activity_events_type_occurred_at" },
        { fields: ["invoice_id"], name: "idx_activity_events_invoice_id" },
        { fields: ["actor_user_id"], name: "idx_activity_events_actor_user_id" },
      ],
    },
  );
  return ActivityEvent;
};
