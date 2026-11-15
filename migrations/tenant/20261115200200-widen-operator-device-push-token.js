// migrations/tenant/20261115200200-widen-operator-device-push-token.js
//
// Widen OPERATOR_DEVICES.push_token to STRING(512) so long FCM registration
// tokens are stored intact without truncation.

import { DataTypes } from "sequelize";
import { tableExists, hasColumn, repairZeroDates } from "../lib/schemaGuards.js";

const TABLE = "OPERATOR_DEVICES";

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) return;
  if (!(await hasColumn(qi, TABLE, "push_token"))) return;

  await repairZeroDates(qi, TABLE);
  await qi.changeColumn(TABLE, "push_token", {
    type: DataTypes.STRING(512),
    allowNull: true,
  });
};

export const down = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) return;
  if (!(await hasColumn(qi, TABLE, "push_token"))) return;

  await repairZeroDates(qi, TABLE);
  await qi.changeColumn(TABLE, "push_token", {
    type: DataTypes.STRING(255),
    allowNull: true,
  });
};
