// migrations/master/20261019150000-fix-pairing-codes-tenant-id-type.js
//
// Corrective: the original 20261019140000 migration declared
// DEVICE_PAIRING_CODES.tenant_id as INTEGER, but the master TENANTS.tenant_id
// column is actually STRING(36) (UUID). Inserting a UUID string into the INT
// column raises MySQL's "Truncated incorrect DOUBLE value: '…uuid…'" error
// on every attempt to mint a pairing code.
//
// Safe to run on prod: no CLAIMED rows exist yet because minting never
// succeeded with the broken type. We ALSO scrub any PENDING / EXPIRED rows
// so changeColumn can't trip on bad legacy data.

import { DataTypes } from "sequelize";

const columnType = async (queryInterface, table, column) => {
  try {
    const desc = await queryInterface.describeTable(table);
    return desc?.[column]?.type || null;
  } catch {
    return null;
  }
};

export const up = async ({ context: queryInterface }) => {
  const current = await columnType(queryInterface, "DEVICE_PAIRING_CODES", "tenant_id");
  if (!current) return; // table missing — earlier migration never ran, nothing to do

  // Already fixed? Skip.
  if (/VARCHAR|CHAR/i.test(current)) return;

  // Any rows must have had a mangled tenant_id (INT could never hold a UUID).
  // Nuke them so changeColumn is clean.
  await queryInterface.sequelize.query("DELETE FROM DEVICE_PAIRING_CODES");

  await queryInterface.changeColumn("DEVICE_PAIRING_CODES", "tenant_id", {
    type: DataTypes.STRING(36),
    allowNull: false,
  });
};

export const down = async ({ context: queryInterface }) => {
  const current = await columnType(queryInterface, "DEVICE_PAIRING_CODES", "tenant_id");
  if (!current) return;
  if (/INT/i.test(current)) return;
  await queryInterface.sequelize.query("DELETE FROM DEVICE_PAIRING_CODES");
  await queryInterface.changeColumn("DEVICE_PAIRING_CODES", "tenant_id", {
    type: DataTypes.INTEGER,
    allowNull: false,
  });
};
