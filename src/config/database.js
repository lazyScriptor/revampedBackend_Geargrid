import { Sequelize } from "sequelize";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Initialize Sequelize
const sequelize = new Sequelize(
  process.env.DATABASE,
  process.env.USERNAME,
  process.env.PASSWORD,
  {
    host: process.env.HOST,
    dialect: "mysql", // Sequelize uses 'mysql' for both MySQL and MariaDB
    port: 3306, // Default MariaDB/MySQL port is 3306, but fallback to your env
    logging: false, // Set to console.log to see the raw SQL queries Sequelize generates under the hood
    pool: {
      max: 5, // Maximum number of connections in pool
      min: 0, // Minimum number of connections in pool
      acquire: 30000, // Maximum time (in ms) that pool will try to get connection before throwing error
      idle: 10000, // Maximum time (in ms) that a connection can be idle before being released
    },
  },
);

// Optional but highly recommended: A quick function to test the connection
export const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log(
      "✅ Connection to the database has been established successfully.",
    );
  } catch (error) {
    console.error("❌ Unable to connect to the database:", error);
  }
};

export default sequelize;
