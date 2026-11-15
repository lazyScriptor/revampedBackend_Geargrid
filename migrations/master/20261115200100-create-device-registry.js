// migrations/master/20261115200100-create-device-registry.js
//
// Maps each paired device_id to its owning tenant_id in master DB so
// public status lookups avoid scanning every tenant DB and cross-shop
// re-pairing can deterministically clean up the previous shop's row.

import { DataTypes } from "sequelize";
import { tableExists, addIndexIfMissing } from "../lib/schemaGuards.js";

const TABLE = "DEVICE_REGISTRY";

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) {
    await qi.createTable(TABLE, {
      device_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        primaryKey: true,
      },
      // Matches master.TENANTS.tenant_id (UUID STRING(36)).
      tenant_id: {
        type: DataTypes.STRING(36),
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: qi.sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: qi.sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });
  }

  await addIndexIfMissing(qi, TABLE, ["tenant_id"], {
    name: "idx_device_registry_tenant_id",
  });
};

export const down = async ({ context: qi }) => {
  if (await tableExists(qi, TABLE)) {
    await qi.dropTable(TABLE);
  }
};
