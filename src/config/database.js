import { Sequelize } from "sequelize";
import dotenv from "dotenv";

dotenv.config();

// =========================================================================
// 1. THE MASTER CONNECTION
// Uses your .env variables to connect to 'geargrid_master'
// =========================================================================
export  const masterSequelize = new Sequelize(
  process.env.DATABASE,
  process.env.USERNAME,
  process.env.PASSWORD,
  {
    host: process.env.HOST,
    dialect: "mysql",
    logging: false, // Set to true if you want to see Master SQL queries
  },
);

// =========================================================================
// 2. THE TENANT CONNECTION CACHE
// We store active tenant connections here so we don't open 1000 connections
// if a tenant makes 1000 requests.
// =========================================================================
const tenantConnections = {};

// =========================================================================
// 3. DYNAMIC TENANT CONNECTION FACTORY
// =========================================================================
export  const getTenantConnection = async (
  dbName,
  dbUser,
  dbPassword,
  dbHost,
) => {
  // If we already connected to this tenant's DB recently, return the cached connection
  if (tenantConnections[dbName]) {
    return tenantConnections[dbName];
  }

  // Otherwise, create a new Sequelize connection for this specific tenant
  const tenantSeq = new Sequelize(dbName, dbUser, dbPassword, {
    host: dbHost,
    dialect: "mysql",
    logging: false,
  });

  try {
    await tenantSeq.authenticate();
    console.log(`Successfully connected to tenant database: ${dbName}`);

    // Cache it for future requests
    tenantConnections[dbName] = tenantSeq;
    return tenantSeq;
  } catch (error) {
    console.error(`Unable to connect to tenant database ${dbName}:`, error);
    throw error;
  }
};
