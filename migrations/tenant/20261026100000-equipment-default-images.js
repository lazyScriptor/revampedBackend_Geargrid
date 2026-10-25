// migrations/tenant/20261026100000-equipment-default-images.js
//
// Gives every machine WITHOUT a photo a clean, background-removed stock photo of its machine type
// (cut-outs of Pexels photos, shipped in the frontend at /equipment/<key>.webp).
//   • matching is by machine name using migrations/data/equipment-image-rules.json
//   • only rows whose image_url is empty are touched — a photo someone added is never overwritten
//   • items with no good photo (rule `skip` / no rule) are left empty
// Idempotent. Down only clears images this migration set (those under the shared base URL).

import { loadImageMap, loadImageRules, matchEquipmentImageKey } from "../../src/utils/equipmentImageRules.js";

const BASE = (process.env.EQUIPMENT_IMAGE_BASE_URL || "https://app.geargrid.live/equipment/").replace(/\/?$/, "/");

export const up = async ({ context: queryInterface }) => {
  const sequelize = queryInterface.sequelize;
  const images = loadImageMap();
  const rules = loadImageRules();

  const [rows] = await sequelize.query(
    "SELECT equipment_id, equipment_name FROM EQUIPMENT WHERE image_url IS NULL OR image_url = ''",
  );

  const idsByFile = new Map();
  for (const row of rows) {
    const key = matchEquipmentImageKey(row.equipment_name, rules);
    const file = key && images[key];
    if (!file) continue;
    if (!idsByFile.has(file)) idsByFile.set(file, []);
    idsByFile.get(file).push(row.equipment_id);
  }

  let updated = 0;
  for (const [file, ids] of idsByFile) {
    await sequelize.query(
      "UPDATE EQUIPMENT SET image_url = ? WHERE equipment_id IN (?) AND (image_url IS NULL OR image_url = '')",
      { replacements: [`${BASE}${file}`, ids] },
    );
    updated += ids.length;
  }
  console.log(`[equipment-default-images] ${updated} of ${rows.length} machines without a photo received one`);
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.sequelize.query("UPDATE EQUIPMENT SET image_url = NULL WHERE image_url LIKE ?", {
    replacements: [`${BASE}%`],
  });
};
