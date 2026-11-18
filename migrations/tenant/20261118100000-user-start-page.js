import { DataTypes } from "sequelize";
import { addColumnIfMissing } from "../lib/schemaGuards.js";

// Each user's chosen page after signing in. Empty means the default (Invoicing).

export const up = async ({ context: qi }) => {
  await addColumnIfMissing(qi, "USERS", "start_page", {
    type: DataTypes.STRING(40),
    allowNull: true,
  });
};

export const down = async ({ context: qi }) => {
  const desc = await qi.describeTable("USERS");
  if (desc.start_page) await qi.removeColumn("USERS", "start_page");
};
