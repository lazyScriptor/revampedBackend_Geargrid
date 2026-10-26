import { DataTypes } from "sequelize";

// A shop's own wording for one message type + language. No row = the built-in default.
export default (sequelize) => {
  const WhatsappTemplate = sequelize.define(
    "WhatsappTemplate",
    {
      template_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      template_key: { type: DataTypes.STRING(40), allowNull: false },
      language: { type: DataTypes.STRING(5), allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: false },
      updated_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      tableName: "WHATSAPP_TEMPLATES",
      timestamps: true,
      charset: "utf8mb4",
      collate: "utf8mb4_unicode_ci",
      indexes: [{ unique: true, fields: ["template_key", "language"] }],
    },
  );
  return WhatsappTemplate;
};
