import { DataTypes } from "sequelize";

// One-time codes for setting a new password. Only a hash of the code is stored.
export default (sequelize) => {
  const PasswordResetCode = sequelize.define(
    "PasswordResetCode",
    {
      code_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      global_user_id: { type: DataTypes.INTEGER, allowNull: false },
      code_hash: { type: DataTypes.STRING(64), allowNull: false },
      channel: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "email" },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      used_at: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: "PASSWORD_RESET_CODES", timestamps: true, updatedAt: false },
  );
  return PasswordResetCode;
};
