// migrations/master/20261115210200-seed-phone-app-versions-part-d10.js
import { DataTypes } from "sequelize";
import { tableExists } from "../lib/schemaGuards.js";

const TABLE = "PLATFORM_CONFIG";

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) {
    await qi.createTable(
      TABLE,
      {
        config_key: {
          type: DataTypes.STRING(100),
          primaryKey: true,
          allowNull: false,
        },
        config_value: {
          type: DataTypes.JSON,
          allowNull: false,
        },
        updatedAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: qi.sequelize.literal("CURRENT_TIMESTAMP"),
        },
      },
      { charset: "utf8mb4", collate: "utf8mb4_unicode_ci" },
    );
  }

  await qi.sequelize.query(
    `INSERT IGNORE INTO \`${TABLE}\` (\`config_key\`, \`config_value\`, \`updatedAt\`)
     VALUES
       ('min_app_version', '"1.0.0"', NOW()),
       ('latest_app_version', '"1.0.0"', NOW())`,
  );
};

export const down = async ({ context: qi }) => {
  if (!(await tableExists(qi, TABLE))) return;
  await qi.sequelize.query(
    `DELETE FROM \`${TABLE}\` WHERE \`config_key\` IN ('min_app_version', 'latest_app_version')`,
  );
};
