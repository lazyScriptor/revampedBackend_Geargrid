// A new user's emailed password is temporary: they choose their own at first login. Safe to run twice.
import { DataTypes } from "sequelize";

export const up = async ({ context: queryInterface }) => {
  const users = await queryInterface.describeTable("USERS");
  if (!users.must_change_password) {
    await queryInterface.addColumn("USERS", "must_change_password", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  }
};

export const down = async ({ context: queryInterface }) => {
  const users = await queryInterface.describeTable("USERS");
  if (users.must_change_password) await queryInterface.removeColumn("USERS", "must_change_password");
};
