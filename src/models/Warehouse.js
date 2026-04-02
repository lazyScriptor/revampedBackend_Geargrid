import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Warehouse = sequelize.define(
    "Warehouse",
    {
      warehouse_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      location_name: { type: DataTypes.STRING(255), allowNull: false },
      address: { type: DataTypes.TEXT, allowNull: true },
      contact_number: { type: DataTypes.STRING(50), allowNull: true },
    },
    {
      tableName: "WAREHOUSES",
      timestamps: false,
    },
  );
  return Warehouse;
};
