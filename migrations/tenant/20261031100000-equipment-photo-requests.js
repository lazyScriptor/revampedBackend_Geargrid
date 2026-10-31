// migrations/tenant/20261031100000-equipment-photo-requests.js
//
// PHOTO_REQUESTS — the counter asks the paired phone to photograph a machine
// (same flow as signature requests). Idempotent: new tenants get the table
// from model sync first.

import { DataTypes } from "sequelize";
import { tableExists, addIndexIfMissing } from "../lib/schemaGuards.js";

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, "PHOTO_REQUESTS"))) {
    await qi.createTable(
      "PHOTO_REQUESTS",
      {
        request_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        equipment_id: { type: DataTypes.INTEGER, allowNull: false },
        token: { type: DataTypes.STRING(80), allowNull: false, unique: true },
        requested_by_user_id: { type: DataTypes.INTEGER, allowNull: false },
        status: {
          type: DataTypes.ENUM("PENDING", "COMPLETED", "EXPIRED", "CANCELLED"),
          allowNull: false,
          defaultValue: "PENDING",
        },
        image_url: { type: DataTypes.STRING(500), allowNull: true },
        expires_at: { type: DataTypes.DATE, allowNull: false },
        completed_at: { type: DataTypes.DATE, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
      },
      { charset: "utf8mb4", collate: "utf8mb4_unicode_ci" },
    );
  }
  await addIndexIfMissing(qi, "PHOTO_REQUESTS", ["requested_by_user_id", "status"], { name: "idx_photo_req_user_status" });
  await addIndexIfMissing(qi, "PHOTO_REQUESTS", ["expires_at"], { name: "idx_photo_req_expires" });
};

export const down = async ({ context: qi }) => {
  if (await tableExists(qi, "PHOTO_REQUESTS")) await qi.dropTable("PHOTO_REQUESTS");
};
