import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Customer = sequelize.define(
    "Customer",
    {
      customer_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      nic_number: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true,
      },
      first_name: { type: DataTypes.STRING(100), allowNull: false },
      last_name: { type: DataTypes.STRING(100), allowNull: false },
      phone_number: { type: DataTypes.STRING(50), allowNull: false },
      address_line1: { type: DataTypes.STRING(255) },
      address_line2: { type: DataTypes.STRING(255) },
      rating: { type: DataTypes.INTEGER, defaultValue: 5 },
      customer_delete_status: { type: DataTypes.BOOLEAN, defaultValue: false },
    },
    {
      tableName: "CUSTOMERS",
      timestamps: false,
    },
  );
  return Customer;
};
