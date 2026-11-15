import { DataTypes } from "sequelize";

export default (sequelize) => {
  const CustomerPhone = sequelize.define(
    "CustomerPhone",
    {
      phone_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      customer_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      phone_e164: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      is_primary: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "CUSTOMER_PHONES",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["customer_id", "phone_e164"],
          name: "uq_customer_phones_cust_e164",
        },
        {
          fields: ["phone_e164"],
          name: "idx_customer_phones_e164",
        },
      ],
    },
  );

  return CustomerPhone;
};
