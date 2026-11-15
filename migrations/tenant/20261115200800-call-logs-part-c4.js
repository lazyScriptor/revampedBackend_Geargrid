import { DataTypes } from "sequelize";
import { addColumnIfMissing, tableExists } from "../lib/schemaGuards.js";

const TABLE = "CALL_LOGS";

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) return;

  await addColumnIfMissing(qi, TABLE, "sim_label", {
    type: DataTypes.STRING(40),
    allowNull: true,
    defaultValue: null,
  });

  await addColumnIfMissing(qi, TABLE, "number_masked", {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });

  await addColumnIfMissing(qi, TABLE, "callback_handled_at", {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null,
  });
};

export const down = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) return;
  const cols = await qi.describeTable(TABLE);
  for (const col of ["callback_handled_at", "number_masked", "sim_label"]) {
    if (Object.prototype.hasOwnProperty.call(cols, col)) {
      await qi.removeColumn(TABLE, col);
    }
  }
};
