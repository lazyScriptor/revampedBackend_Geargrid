import { DataTypes } from "sequelize";

export default (sequelize) => {
  const ApprovalToken = sequelize.define(
    "ApprovalToken",
    {
      token_hash: {
        type: DataTypes.STRING(64),
        primaryKey: true,
      },
      exception_id: { type: DataTypes.INTEGER, allowNull: true },
      action: { type: DataTypes.STRING(40), allowNull: false },
      approver_user_id: { type: DataTypes.INTEGER, allowNull: false },
      requester_user_id: { type: DataTypes.INTEGER, allowNull: false },
      context: { type: DataTypes.JSON, allowNull: true },
      context_hash: { type: DataTypes.STRING(64), allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      used_at: { type: DataTypes.DATE, allowNull: true },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "APPROVAL_TOKENS",
      timestamps: false,
      indexes: [
        { fields: ["expires_at"], name: "idx_approval_tokens_expires_at" },
        { fields: ["exception_id"], name: "idx_approval_tokens_exception_id" },
      ],
    },
  );

  return ApprovalToken;
};
