import { DataTypes } from "sequelize";

// One row each time staff open a WhatsApp chat from the hub. Click-to-chat cannot tell us
// whether the message was actually sent, so `status` starts as 'opened' and staff can
// confirm 'sent'. Kept as an audit trail and to avoid nagging a customer twice.
export default (sequelize) => {
  const WhatsappMessageLog = sequelize.define(
    "WhatsappMessageLog",
    {
      log_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      customer_id: { type: DataTypes.INTEGER, allowNull: true },
      invoice_id: { type: DataTypes.INTEGER, allowNull: true },
      template_key: { type: DataTypes.STRING(40), allowNull: false },
      language: { type: DataTypes.STRING(5), allowNull: false, defaultValue: "en" },
      to_phone: { type: DataTypes.STRING(20), allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: false },
      channel: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "link" },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "opened" },
      sent_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
    },
    { tableName: "WHATSAPP_MESSAGE_LOGS", timestamps: true },
  );
  return WhatsappMessageLog;
};
