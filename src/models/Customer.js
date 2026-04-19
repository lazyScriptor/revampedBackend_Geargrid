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
      // --- Hierarchical & Business Data ---
      customer_type: {
        type: DataTypes.ENUM("Individual", "Business"),
        defaultValue: "Individual",
        allowNull: false,
      },
      company_name: {
        type: DataTypes.STRING(255),
        allowNull: true, // Only used if customer_type is 'Business'
      },
      parent_customer_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "CUSTOMERS", // Self-referential link
          key: "customer_id",
        },
      },

      // --- Personal Info ---
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

      // --- CRM & Collateral ---
      is_id_retained_currently: {
        type: DataTypes.BOOLEAN,
        defaultValue: false, // Flips to true when the shop physically holds their NIC
      },
      deposit_balance: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.0, // Tracks floating advance cash
      },
      rating: { type: DataTypes.INTEGER, defaultValue: 5 },
      status: {
        type: DataTypes.ENUM("Active", "Blacklisted"),
        defaultValue: "Active", // Allows you to ban a bad contractor
      },
      customer_delete_status: { type: DataTypes.BOOLEAN, defaultValue: false },
    },
    {
      tableName: "CUSTOMERS",
      timestamps: true, // CRITICAL FOR REPORTING: Adds createdAt and updatedAt
    },
  );

  // Define the associations right here so Sequelize knows how to join them
  Customer.associate = (models) => {
    // A worker belongs to a parent company
    Customer.belongsTo(models.Customer, {
      as: "ParentCompany",
      foreignKey: "parent_customer_id",
    });
    // A parent company has many workers
    Customer.hasMany(models.Customer, {
      as: "Workers",
      foreignKey: "parent_customer_id",
    });
  };

  return Customer;
};
