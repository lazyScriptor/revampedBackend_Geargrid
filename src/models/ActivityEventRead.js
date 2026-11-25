import { DataTypes } from "sequelize";

export default (sequelize) => {
  const ActivityEventRead = sequelize.define(
    "ActivityEventRead",
    {
      event_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      read_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "ACTIVITY_EVENT_READS",
      timestamps: false,
    },
  );
  return ActivityEventRead;
};
