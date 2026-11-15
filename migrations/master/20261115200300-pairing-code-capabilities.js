import { DataTypes } from "sequelize";
import { addColumnIfMissing, tableExists } from "../lib/schemaGuards.js";

const TABLE = "DEVICE_PAIRING_CODES";

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) return;
  await addColumnIfMissing(qi, TABLE, "requested_capabilities", {
    type: DataTypes.JSON,
    allowNull: true,
  });
};

export const down = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) return;
  const cols = await qi.describeTable(TABLE);
  if (Object.prototype.hasOwnProperty.call(cols, "requested_capabilities")) {
    await qi.removeColumn(TABLE, "requested_capabilities");
  }
};
