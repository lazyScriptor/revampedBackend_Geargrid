// migrations/tenant/20261115210100-phone-contacts-leads-part-d7.js
import { DataTypes } from "sequelize";
import {
  tableExists,
  addColumnIfMissing,
  addIndexIfMissing,
  repairZeroDates,
} from "../lib/schemaGuards.js";

const TABLE = "PHONE_CONTACTS";

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) return;

  const cols = await qi.describeTable(TABLE);
  if (cols.operator_device_id && cols.operator_device_id.allowNull === false) {
    await repairZeroDates(qi, TABLE);
    await qi.changeColumn(TABLE, "operator_device_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
  }

  await addColumnIfMissing(qi, TABLE, "source", {
    type: DataTypes.ENUM("phone", "lead"),
    allowNull: false,
    defaultValue: "phone",
  });

  await addColumnIfMissing(qi, TABLE, "notes", {
    type: DataTypes.STRING(500),
    allowNull: true,
  });

  await addColumnIfMissing(qi, TABLE, "created_by_user_id", {
    type: DataTypes.INTEGER,
    allowNull: true,
  });

  await addIndexIfMissing(qi, TABLE, ["source", "created_by_user_id"], {
    name: "idx_phone_contacts_source_creator",
  });
};

export const down = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) return;
  const cols = await qi.describeTable(TABLE);
  if (cols.created_by_user_id) {
    await qi.removeColumn(TABLE, "created_by_user_id");
  }
  if (cols.notes) {
    await qi.removeColumn(TABLE, "notes");
  }
  if (cols.source) {
    await qi.removeColumn(TABLE, "source");
  }
};
