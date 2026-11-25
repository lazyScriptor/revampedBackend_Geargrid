import { DataTypes } from "sequelize";

export default (sequelize) => {
  const CallRecording = sequelize.define(
    "CallRecording",
    {
      recording_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      call_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      storage_key: {
        type: DataTypes.STRING(512),
        allowNull: false,
      },
      mime_type: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      bytes: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      duration_seconds: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      sha256: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      uploaded_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      device_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      dispute_hold: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "CALL_RECORDINGS",
      timestamps: false,
      indexes: [
        { unique: true, fields: ["call_id"], name: "uq_call_recordings_call_id" },
        { fields: ["uploaded_at"], name: "idx_call_recordings_uploaded_at" },
      ],
    },
  );

  return CallRecording;
};
