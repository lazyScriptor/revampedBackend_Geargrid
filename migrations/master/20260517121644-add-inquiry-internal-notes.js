// 20260517121644-add-inquiry-internal-notes.js
// Adds an admin-only notes column to CONTACT_INQUIRIES so super admins can
// log triage context per inquiry (who they spoke to, follow-up date, etc.)
// without polluting the public-facing `message` field.

import { DataTypes } from "sequelize";

export const up = async ({ context: queryInterface }) => {
  await queryInterface.addColumn("CONTACT_INQUIRIES", "internal_notes", {
    type: DataTypes.TEXT,
    allowNull: true,
  });
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.removeColumn("CONTACT_INQUIRIES", "internal_notes");
};
