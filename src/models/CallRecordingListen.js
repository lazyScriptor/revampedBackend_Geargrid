import { DataTypes } from "sequelize";

export default (sequelize) => {
  const CallRecordingListen = sequelize.define(
    "CallRecordingListen",
    {
      listen_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      recording_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      listened_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "CALL_RECORDING_LISTENS",
      timestamps: false,
      indexes: [
        { fields: ["recording_id", "listened_at"], name: "idx_call_recording_listens_rec_at" },
      ],
    },
  );

  return CallRecordingListen;
};
