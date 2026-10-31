import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Invoice = sequelize.define(
    "Invoice",
    {
      invoice_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      customer_id: { type: DataTypes.INTEGER, allowNull: false },
      // Optional secondary attribution: the person physically taking the
      // equipment is `customer_id`; if they are renting it on behalf of a
      // family member / company, that parent customer goes here. Both rows
      // appear in either customer's rental history.
      borrowed_on_behalf_of_customer_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      issued_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
      total_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      advance_paid: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      transport_fee: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      discount_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      sub_total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      id_card_status: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 0,
      },
      number_of_days_of_the_bill: { type: DataTypes.INTEGER, allowNull: false },
      status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "Active",
      },
      issued_date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      // Soft delete ("void with a reason"). Deleted invoices are hidden everywhere by the
      // default scope; use Invoice.unscoped() for the delete/restore flow and the deleted report.
      is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      // An old cash advance that already went home before the cash locker started: not held in the drawer.
      advance_at_home: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      // Charges so far for machines still out (extra / late days), not yet billed into total_amount.
      // Kept current by services/accrualService.js; becomes 0 once everything is back.
      accrued_charges: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      accrued_at: { type: DataTypes.DATE, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
      deleted_by: { type: DataTypes.INTEGER, allowNull: true },
      deleted_by_role: { type: DataTypes.STRING(100), allowNull: true },
      delete_reason: { type: DataTypes.STRING(100), allowNull: true },
      delete_note: { type: DataTypes.STRING(500), allowNull: true },
      delete_flagged: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      restored_at: { type: DataTypes.DATE, allowNull: true },
      restored_by: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      tableName: "INVOICES",
      timestamps: false,
      defaultScope: { where: { is_deleted: false } },
    },
  );
  // What the API sends: `total_amount` is what the customer owes for so far (billed + charges so
  // far), so every screen, balance and report shows the same number. The billed figure stays
  // available as `billed_total_amount`. Services reading `invoice.total_amount` still get the billed
  // value from the database; this only shapes the JSON.
  Invoice.prototype.toJSON = function toJSON() {
    const plain = this.get({ plain: true });
    if (plain.total_amount !== undefined && plain.accrued_charges !== undefined) {
      const billed = Number(plain.total_amount) || 0;
      plain.billed_total_amount = billed;
      plain.total_amount = Math.round((billed + (Number(plain.accrued_charges) || 0)) * 100) / 100;
    }
    return plain;
  };

  return Invoice;
};
