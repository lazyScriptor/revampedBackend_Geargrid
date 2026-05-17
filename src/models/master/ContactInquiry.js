import { DataTypes } from "sequelize";

// Platform-level table that captures every inbound enquiry from the public
// landing page. Lives in the master DB because the visitor isn't a tenant user.
export const defineContactInquiry = (sequelize) =>
  sequelize.define(
    "ContactInquiry",
    {
      inquiry_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
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
      // Audit context (IP from x-forwarded-for, UA, referrer) — useful for
      // spam triage and analytics, no PII concerns.
      source_ip: { type: DataTypes.STRING(64), allowNull: true },
      user_agent: { type: DataTypes.STRING(500), allowNull: true },
      referrer: { type: DataTypes.STRING(500), allowNull: true },
    },
    {
      tableName: "CONTACT_INQUIRIES",
      timestamps: true,
      indexes: [
        { fields: ["email"] },
        { fields: ["status"] },
        { fields: ["createdAt"] },
      ],
    },
  );

export default defineContactInquiry;
