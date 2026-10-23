// migrations/tenant/20261023100000-add-equipment-name-si.js
//
// Adds EQUIPMENT.equipment_name_si — the Sinhala display name of a machine,
// shown beside the English name and searchable. Nullable: existing rows stay
// untouched until a user converts them (one-click "Convert to Sinhala") or types one.
//
// Idempotent: checks the schema before altering.

import { DataTypes } from "sequelize";

export const up = async ({ context: queryInterface }) => {
  const table = await queryInterface.describeTable("EQUIPMENT");
  if (!table.equipment_name_si) {
    await queryInterface.addColumn("EQUIPMENT", "equipment_name_si", {
      type: DataTypes.STRING(255),
      allowNull: true,
      after: "equipment_name",
    });
  }
};

export const down = async ({ context: queryInterface }) => {
  const table = await queryInterface.describeTable("EQUIPMENT");
  if (table.equipment_name_si) {
    await queryInterface.removeColumn("EQUIPMENT", "equipment_name_si");
  }
};
