import { DataTypes } from "sequelize";

// A request from the counter for the paired phone to photograph one machine.
// Same lifecycle as SignatureRequest: token-authorised, short-lived, closed
// when the photo arrives or the counter cancels.
export default (sequelize) => {
  const PhotoRequest = sequelize.define(
    "PhotoRequest",
    {
      request_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      equipment_id: { type: DataTypes.INTEGER, allowNull: false },
      token: { type: DataTypes.STRING(80), allowNull: false, unique: true },
      requested_by_user_id: { type: DataTypes.INTEGER, allowNull: false },
      status: {
        type: DataTypes.ENUM("PENDING", "COMPLETED", "EXPIRED", "CANCELLED"),
        allowNull: false,
        defaultValue: "PENDING",
      },
      image_url: { type: DataTypes.STRING(500), allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      completed_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "PHOTO_REQUESTS",
      timestamps: true,
      indexes: [{ fields: ["requested_by_user_id", "status"] }, { fields: ["expires_at"] }],
    },
  );
  return PhotoRequest;
};
