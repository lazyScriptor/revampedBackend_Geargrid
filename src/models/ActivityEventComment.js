import { DataTypes } from "sequelize";

export default (sequelize) => {
  const ActivityEventComment = sequelize.define(
    "ActivityEventComment",
    {
      comment_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      event_id: { type: DataTypes.INTEGER, allowNull: false },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: false },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "ACTIVITY_EVENT_COMMENTS",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
      indexes: [
        { fields: ["event_id"], name: "idx_activity_event_comments_event_id" },
      ],
    },
  );
  return ActivityEventComment;
};
