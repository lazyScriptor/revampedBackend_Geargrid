import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Maps a machine name ("Bosch Hammer Drill 800W", "Grinder ( 4 inch ) -7") to a generic image key
 * ("hammer-drill", "angle-grinder") using migrations/data/equipment-image-rules.json.
 * Rules are evaluated in order, first match wins; a rule marked `skip` means "no photo for this item".
 * The same rules file drives tools/equipment-images/build_images.py, so photos and names stay in sync.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(here, "..", "..", "migrations", "data");

export const loadImageRules = () =>
  JSON.parse(fs.readFileSync(path.join(DATA_DIR, "equipment-image-rules.json"), "utf8")).map((r) => ({
    ...r,
    re: new RegExp(r.pattern, "i"),
  }));

export const loadImageMap = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, "equipment-images.json"), "utf8")).images || {};

/** @returns {string|null} image key, or null when no rule matches or the rule says skip */
export const matchEquipmentImageKey = (name, rules = loadImageRules()) => {
  const clean = String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!clean) return null;
  for (const rule of rules) {
    if (rule.re.test(clean)) return rule.skip ? null : rule.key;
  }
  return null;
};
