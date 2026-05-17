// 20260517093958-add-contact-inquiries.js
// Creates CONTACT_INQUIRIES in the master DB. Source of truth for every
// inbound message from the public marketing site (contact page, demo modal).

import { DataTypes } from "sequelize";

export const up = async ({ context: queryInterface }) => {
  await queryInterface.createTable("CONTACT_INQUIRIES", {
    inquiry_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    name: { type: DataTypes.STRING(120), allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false },
    company: { type: DataTypes.STRING(120), allowNull: true },
    phone: { type: DataTypes.STRING(40), allowNull: true },
    inquiry_type: {
      type: DataTypes.ENUM("demo", "sales", "support", "partnership", "other"),
      allowNull: false,
      defaultValue: "demo",
    },
    message: { type: DataTypes.TEXT, allowNull: false },
    status: {
      type: DataTypes.ENUM("new", "contacted", "qualified", "closed"),
      allowNull: false,
      defaultValue: "new",
    },
    source_ip: { type: DataTypes.STRING(64), allowNull: true },
    user_agent: { type: DataTypes.STRING(500), allowNull: true },
    referrer: { type: DataTypes.STRING(500), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  await queryInterface.addIndex("CONTACT_INQUIRIES", ["email"]);
  await queryInterface.addIndex("CONTACT_INQUIRIES", ["status"]);
  await queryInterface.addIndex("CONTACT_INQUIRIES", ["createdAt"]);
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.dropTable("CONTACT_INQUIRIES");
};
