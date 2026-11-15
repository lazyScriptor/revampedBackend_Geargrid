import { DataTypes } from "sequelize";

export default (sequelize) => {
  const PushPreference = sequelize.define(
    "PushPreference",
    {
      preference_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      event_key: {
        type: DataTypes.STRING(40),
        allowNull: false,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      min_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },
    },
    {
      tableName: "PUSH_PREFERENCES",
      timestamps: true,
      indexes: [
        { unique: true, fields: ["user_id", "event_key"] },
        { fields: ["user_id"] },
      ],
    },
  );

  return PushPreference;
};
