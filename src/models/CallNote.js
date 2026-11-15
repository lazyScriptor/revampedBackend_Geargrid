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
      ],
    },
  );

  return CallNote;
};
