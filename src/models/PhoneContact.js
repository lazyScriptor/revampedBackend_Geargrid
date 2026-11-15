import { DataTypes } from "sequelize";

export default (sequelize) => {
  const PhoneContact = sequelize.define(
    "PhoneContact",
    {
      contact_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      operator_device_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      source: {
        type: DataTypes.ENUM("phone", "lead"),
        allowNull: false,
        defaultValue: "phone",
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
      notes: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      linked_customer_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      created_by_user_id: {
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
    },
    {
      tableName: "PHONE_CONTACTS",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["operator_device_id", "device_contact_key", "phone_e164"],
          name: "uq_phone_contacts_dev_key_e164",
        },
        {
          fields: ["phone_e164"],
          name: "idx_phone_contacts_e164",
        },
        {
          fields: ["display_name"],
          name: "idx_phone_contacts_name",
        },
      ],
    },
  );

  return PhoneContact;
};
