import { DataTypes } from "sequelize";

// One row per time someone counts the shop's cash drawer: the morning opening, the evening close
// (with what was sent home), or the one-time start. The drawer's expected amount at any moment is
// the latest row's `left_in_drawer` plus the cash movements recorded after its `counted_at`.
export default (sequelize) => {
  const CashLockerCount = sequelize.define(
    "CashLockerCount",
    {
      count_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      kind: { type: DataTypes.STRING(10), allowNull: false }, // START | OPENING | CLOSING
      business_date: { type: DataTypes.DATEONLY, allowNull: false },
      counted_at: { type: DataTypes.DATE, allowNull: false },
      counted_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      // What the system expected to find (null when there was nothing to compare with).
      expected_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      difference: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      keep_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      sent_home: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      left_in_drawer: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: true },
      counted_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
      reviewed_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
      reviewed_at: { type: DataTypes.DATE, allowNull: true },
      review_note: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "CASH_LOCKER_COUNTS",
      timestamps: true,
      indexes: [{ fields: ["business_date"] }, { fields: ["counted_at"] }],
    },
  );
  return CashLockerCount;
};
