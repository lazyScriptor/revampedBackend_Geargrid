// migrations/master/20261019140000-create-device-pairing-codes.js
//
// Introduces DEVICE_PAIRING_CODES on the master DB. Pairing codes live
// cross-tenant because the phone claims a code BEFORE knowing which tenant
// it belongs to — the backend uses the code to look up the owning
// tenant_id, then provisions the OperatorDevice row inside that tenant.
//
// Lifecycle:
//   • Operator (auth) → generates code; row inserted PENDING with their
//     user_id, tenant_id, and 10-min TTL.
//   • Phone (public) → POSTs { code, device_id } → backend finds the row,
//     switches to the owning tenant DB, inserts into OPERATOR_DEVICES,
//     flips the master code row to CLAIMED.

import { DataTypes } from "sequelize";

const tableExists = async (queryInterface, table) => {
  try {
    await queryInterface.describeTable(table);
    return true;
  } catch {
    return false;
  }
};

export const up = async ({ context: queryInterface }) => {
  if (!(await tableExists(queryInterface, "DEVICE_PAIRING_CODES"))) {
    await queryInterface.createTable("DEVICE_PAIRING_CODES", {
      pairing_code_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      // Short, uppercase, dash-separated for human reading. Random.
      code: { type: DataTypes.STRING(16), allowNull: false, unique: true },
      // Which tenant / operator this code is bound to at mint time.
      tenant_id: { type: DataTypes.INTEGER, allowNull: false },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      status: {
        type: DataTypes.ENUM("PENDING", "CLAIMED", "EXPIRED"),
        allowNull: false,
        defaultValue: "PENDING",
      },
      // The device_id the phone POSTs when claiming. Only non-null after claim.
      claimed_device_id: { type: DataTypes.STRING(64), allowNull: true },
      claimed_at: { type: DataTypes.DATE, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });

    await queryInterface.addIndex("DEVICE_PAIRING_CODES", ["code"]);
    await queryInterface.addIndex("DEVICE_PAIRING_CODES", ["tenant_id"]);
    await queryInterface.addIndex("DEVICE_PAIRING_CODES", ["status"]);
    await queryInterface.addIndex("DEVICE_PAIRING_CODES", ["expires_at"]);
  }
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.dropTable("DEVICE_PAIRING_CODES");
};
