import { DataTypes } from "sequelize";
import { addColumnIfMissing } from "../lib/schemaGuards.js";

export const up = async ({ context: qi }) => {
  await addColumnIfMissing(qi, "RETAIL_CATEGORIES", "item_name", {
    type: DataTypes.STRING(150),
    allowNull: true,
  });
  await addColumnIfMissing(qi, "RETAIL_CATEGORIES", "item_name_si", {
    type: DataTypes.STRING(150),
    allowNull: true,
  });
};

export const down = async ({ context: qi }) => {
  const cols = await qi.describeTable("RETAIL_CATEGORIES");
  if (cols.item_name_si) {
    await qi.removeColumn("RETAIL_CATEGORIES", "item_name_si");
  }
  if (cols.item_name) {
    await qi.removeColumn("RETAIL_CATEGORIES", "item_name");
  }
};
