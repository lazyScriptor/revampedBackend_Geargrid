import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Equipment = sequelize.define(
    "Equipment",
    {
      equipment_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      category_id: { type: DataTypes.INTEGER, allowNull: false },
      warehouse_id: { type: DataTypes.INTEGER, allowNull: false },
      is_bulk_item: { type: DataTypes.BOOLEAN, defaultValue: false },
      equipment_name: { type: DataTypes.STRING(255), allowNull: false },
      serial_number: { type: DataTypes.STRING(100), allowNull: true },
      total_owned_qty: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      available_qty: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      rented_qty: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      defective_qty: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      purchase_cost: { type: DataTypes.DECIMAL(10, 2) },
      base_rental_price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      minimum_rental_days: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      extra_daily_rate: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      warranty_period_months: { type: DataTypes.INTEGER },
      end_of_warranty_date: { type: DataTypes.DATEONLY },
      image_url: { type: DataTypes.TEXT },
    },
    {
      tableName: "EQUIPMENT",
      timestamps: true,
    },
  );
  return Equipment;
};
