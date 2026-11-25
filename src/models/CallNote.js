import { DataTypes } from "sequelize";

export default (sequelize) => {
  const CallNote = sequelize.define(
    "CallNote",
    {
      note_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      call_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      customer_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      contact_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      tags: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      follow_up_on: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      follow_up_done_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      outcome: {
        type: DataTypes.ENUM("answered", "no_answer", "unreachable"),
        allowNull: true,
        validate: {
          isIn: [["answered", "no_answer", "unreachable"]],
        },
      },
      result: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      promise_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },
      promise_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      promise_kept_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      promise_status: {
        type: DataTypes.ENUM("waiting", "kept", "missed"),
        allowNull: true,
        validate: {
          isIn: [["waiting", "kept", "missed"]],
        },
      },
      invoice_ids: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      tableName: "CALL_NOTES",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["call_id"], name: "idx_call_notes_call_id" },
        { fields: ["customer_id"], name: "idx_call_notes_customer_id" },
        { fields: ["follow_up_on"], name: "idx_call_notes_follow_up_on" },
        { fields: ["promise_status", "promise_date"], name: "idx_call_notes_promise_status_date" },
      ],
    },
  );

  return CallNote;
};
