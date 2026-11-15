import { DataTypes } from "sequelize";
import { addColumnIfMissing, addIndexIfMissing, tableExists } from "../lib/schemaGuards.js";

const DEVICES = "OPERATOR_DEVICES";
const TEMPLATES = "PUSH_TEMPLATES";

export const up = async ({ context: qi }) => {
  if (await tableExists(qi, DEVICES)) {
    await addColumnIfMissing(qi, DEVICES, "notification_language", { type: DataTypes.STRING(10), allowNull: true });
    await addColumnIfMissing(qi, DEVICES, "app_language", { type: DataTypes.STRING(10), allowNull: true });
    await addColumnIfMissing(qi, DEVICES, "call_text_scale", { type: DataTypes.DECIMAL(3, 2), allowNull: true });
    await addColumnIfMissing(qi, DEVICES, "app_text_size", { type: DataTypes.STRING(12), allowNull: true });
    await addColumnIfMissing(qi, DEVICES, "app_lock_enabled", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  }
  if (!(await tableExists(qi, TEMPLATES))) {
    await qi.createTable(TEMPLATES, {
      template_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      event_key: { type: DataTypes.STRING(40), allowNull: false }, language: { type: DataTypes.STRING(10), allowNull: false },
      title: { type: DataTypes.STRING(160), allowNull: false }, body: { type: DataTypes.STRING(500), allowNull: false },
      title_private: { type: DataTypes.STRING(160), allowNull: true }, body_private: { type: DataTypes.STRING(500), allowNull: true },
      updated_by: { type: DataTypes.INTEGER, allowNull: true }, createdAt: { type: DataTypes.DATE, allowNull: false }, updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  }
  await addIndexIfMissing(qi, TEMPLATES, ["event_key", "language"], { name: "uq_push_templates_event_language", unique: true });
};

export const down = async ({ context: qi }) => {
  if (await tableExists(qi, TEMPLATES)) await qi.dropTable(TEMPLATES);
  if (await tableExists(qi, DEVICES)) {
    const cols = await qi.describeTable(DEVICES);
    for (const name of ["app_lock_enabled", "app_text_size", "call_text_scale", "app_language", "notification_language"]) if (cols[name]) await qi.removeColumn(DEVICES, name);
  }
};
