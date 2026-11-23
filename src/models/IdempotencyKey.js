import { DataTypes } from "sequelize";

export default (sequelize) => {
  const IdempotencyKey = sequelize.define(
    "IdempotencyKey",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      key: { type: DataTypes.STRING(128), allowNull: false },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      route: { type: DataTypes.STRING(160), allowNull: false },
      request_hash: { type: DataTypes.STRING(64), allowNull: false },
      response_status: { type: DataTypes.INTEGER, allowNull: false },
      response_body: { type: DataTypes.JSON, allowNull: true },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "IDEMPOTENCY_KEYS",
      timestamps: false,
      indexes: [
        {
          unique: true,
          fields: ["key", "user_id", "route"],
          name: "uq_idempotency_key_user_route",
        },
        { fields: ["created_at"], name: "idx_idempotency_created_at" },
      ],
    },
  );

  return IdempotencyKey;
};
