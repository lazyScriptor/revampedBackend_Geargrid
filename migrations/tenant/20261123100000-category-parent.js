import { DataTypes } from "sequelize";
import { addColumnIfMissing } from "../lib/schemaGuards.js";

// Two-level categories: a family (Grinders) holds sizes/types (4 inch, 7 inch). Empty parent_id = top level.

export const up = async ({ context: qi }) => {
  await addColumnIfMissing(qi, "EQUIPMENT_CATEGORIES", "parent_id", {
    type: DataTypes.INTEGER,
    allowNull: true,
  });
};

export const down = async ({ context: qi }) => {
  const desc = await qi.describeTable("EQUIPMENT_CATEGORIES");
  if (desc.parent_id) await qi.removeColumn("EQUIPMENT_CATEGORIES", "parent_id");
};
