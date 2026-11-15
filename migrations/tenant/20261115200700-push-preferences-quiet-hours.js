import { DataTypes } from "sequelize";
import { addColumnIfMissing, tableExists } from "../lib/schemaGuards.js";

const TABLE = "PUSH_PREFERENCES";

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) return;

  await addColumnIfMissing(qi, TABLE, "quiet_from", {
    type: DataTypes.STRING(5),
    allowNull: true,
    defaultValue: null,
  });

  await addColumnIfMissing(qi, TABLE, "quiet_to", {
    type: DataTypes.STRING(5),
    allowNull: true,
    defaultValue: null,
  });
};

export const down = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) return;
  const cols = await qi.describeTable(TABLE);
  for (const col of ["quiet_to", "quiet_from"]) {
    if (Object.prototype.hasOwnProperty.call(cols, col)) {
      await qi.removeColumn(TABLE, col);
    }
  }
};
