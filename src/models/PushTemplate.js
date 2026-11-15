import { DataTypes } from "sequelize";

export default (sequelize) => sequelize.define("PushTemplate", {
  template_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  event_key: { type: DataTypes.STRING(40), allowNull: false },
  language: { type: DataTypes.STRING(10), allowNull: false },
  title: { type: DataTypes.STRING(160), allowNull: false },
  body: { type: DataTypes.STRING(500), allowNull: false },
  title_private: { type: DataTypes.STRING(160), allowNull: true },
  body_private: { type: DataTypes.STRING(500), allowNull: true },
  updated_by: { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: "PUSH_TEMPLATES", timestamps: true, indexes: [{ unique: true, fields: ["event_key", "language"] }] });
