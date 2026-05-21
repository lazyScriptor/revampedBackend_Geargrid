import { DataTypes } from "sequelize";

export default (sequelize) => {
  const InvoiceReview = sequelize.define(
    "InvoiceReview",
    {
      review_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      invoice_id: { type: DataTypes.INTEGER, allowNull: false },
      customer_id: { type: DataTypes.INTEGER, allowNull: false },
      author_user_id: { type: DataTypes.INTEGER, allowNull: false },
      stage: {
        type: DataTypes.ENUM("handover", "return", "followup", "adhoc"),
        allowNull: false,
        defaultValue: "return",
      },
      rating: {
        type: DataTypes.TINYINT,
        allowNull: true,
        validate: { min: 1, max: 5 },
      },
      comment: { type: DataTypes.TEXT, allowNull: true },
      is_primary: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      visibility: {
        type: DataTypes.ENUM("internal", "customer_visible"),
        allowNull: false,
        defaultValue: "internal",
      },
    },
    {
      tableName: "INVOICE_REVIEWS",
      timestamps: true,
    },
  );
  return InvoiceReview;
};
