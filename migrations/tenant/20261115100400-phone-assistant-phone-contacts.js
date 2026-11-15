import { DataTypes, literal } from "sequelize";
import { tableExists, addIndexIfMissing } from "../lib/schemaGuards.js";

const TABLE = "PHONE_CONTACTS";

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) {
    await qi.createTable(
      TABLE,
      {
        contact_id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        operator_device_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        device_contact_key: {
          type: DataTypes.STRING(64),
          allowNull: false,
        },
        display_name: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        phone_e164: {
          type: DataTypes.STRING(20),
          allowNull: false,
        },
        raw_phone: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
        linked_customer_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        last_used_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        last_used_by_user_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        createdAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal("CURRENT_TIMESTAMP"),
        },
        updatedAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        },
      },
      { charset: "utf8mb4", collate: "utf8mb4_unicode_ci" },
    );
  }

  await addIndexIfMissing(qi, TABLE, ["operator_device_id", "device_contact_key", "phone_e164"], {
    unique: true,
    name: "uq_phone_contacts_dev_key_e164",
  });
  await addIndexIfMissing(qi, TABLE, ["phone_e164"], {
    name: "idx_phone_contacts_e164",
  });
  await addIndexIfMissing(qi, TABLE, ["display_name"], {
    name: "idx_phone_contacts_name",
  });
};

export const down = async ({ context: qi }) => {
  if (await tableExists(qi, TABLE)) {
    await qi.dropTable(TABLE);
  }
};
