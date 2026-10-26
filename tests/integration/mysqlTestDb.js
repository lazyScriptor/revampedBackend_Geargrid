// Shared by the real-MySQL integration tests. Each test file gets its OWN database
// (<GG_TEST_MYSQL_URL's database>_<suffix>) because vitest runs files in parallel and every
// file wipes and rebuilds the schema it uses.
import { Sequelize } from "sequelize";

export const DB_URL = process.env.GG_TEST_MYSQL_URL;

export const openTestDb = async (suffix) => {
  const u = new URL(DB_URL);
  const base = u.pathname.slice(1);
  if (!/test/i.test(base)) throw new Error(`Refusing to wipe "${base}": the database name must contain "test".`);
  const name = `${base}_${suffix}`;

  u.pathname = "/";
  const admin = new Sequelize(u.toString(), { dialect: "mysql", logging: false });
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4`);
  await admin.close();

  u.pathname = `/${name}`;
  return new Sequelize(u.toString(), { dialect: "mysql", logging: false });
};
