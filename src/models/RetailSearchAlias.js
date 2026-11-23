import { DataTypes } from "sequelize";

export default (sequelize) => {
  const RetailSearchAlias = sequelize.define(
    "RetailSearchAlias",
    {
      alias_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      term: { type: DataTypes.STRING(60), allowNull: false, unique: true },
      means: { type: DataTypes.STRING(60), allowNull: false },
    },
    {
      tableName: "RETAIL_SEARCH_ALIASES",
      timestamps: true,
      indexes: [
        { fields: ["means"], name: "idx_retail_search_aliases_means" },
      ],
    },
  );

  return RetailSearchAlias;
};
