// Groups machines into families (Grinders) and sizes/types (4 inch) from their names.
// "Grinder ( 4 1/2 inch ) -3" -> family Grinder, type 4.5 inch. "Battery Drill - 2" -> Drill / Battery.
import AppError from "../utils/AppError.js";
import { parseName } from "./equipmentNumberService.js";

const FRACTIONS = { "1/2": ".5", "1/4": ".25", "3/4": ".75" };
const tidy = (s) =>
  String(s ?? "")
    .replace(/(\d+)\s+(1\/2|1\/4|3\/4)/g, (_, n, f) => `${n}${FRACTIONS[f]}`)
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—(]+|[\s\-–—)]+$/g, "")
    .trim();
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const keyOf = (s) => s.toLowerCase();

/** { family, type } for one machine name. type is "" when the name has no variant. */
export const splitName = (name) => {
  const text = String(parseName(name).text || name).replace(/\s+/g, " ").trim();
  const open = text.indexOf("(");
  const inside = [...text.matchAll(/\(([^)]*)\)/g)].map((m) => tidy(m[1])).filter(Boolean).join(" ");
  const head = open === -1 ? text : text.slice(0, open);
  // "Miter Saw - big" is the family Miter Saw, type big.
  const dash = head.search(/\s[-–—]\s/);
  const family = tidy(dash === -1 ? head : head.slice(0, dash));
  const afterDash = dash === -1 ? "" : tidy(head.slice(dash + 3));
  return { family, type: [afterDash, inside].filter(Boolean).join(" ") };
};

/** machines: [{ equipment_id, equipment_name, category_id }] -> families with their types. */
export const buildPlan = (machines) => {
  const rows = machines
    .map((m) => ({ ...splitName(m.equipment_name), machine: m }))
    .filter((r) => r.family);

  // "Battery Drill" and "Drill ( with hammer )" belong together: a multi-word family whose last word
  // is itself a family folds into it, the leading words becoming the type.
  const single = new Set(rows.filter((r) => !r.family.includes(" ")).map((r) => keyOf(r.family)));
  for (const r of rows) {
    const words = r.family.split(" ");
    const last = words[words.length - 1];
    if (words.length > 1 && single.has(keyOf(last))) {
      r.type = [words.slice(0, -1).join(" "), r.type].filter(Boolean).join(" ");
      r.family = last;
    }
  }

  const families = new Map();
  for (const r of rows) {
    const fk = keyOf(r.family);
    if (!families.has(fk)) families.set(fk, { name: cap(r.family), types: new Map(), direct: [] });
    const fam = families.get(fk);
    if (r.type) {
      const tk = keyOf(r.type);
      if (!fam.types.has(tk)) fam.types.set(tk, { name: cap(r.type), machines: [] });
      fam.types.get(tk).machines.push(r.machine);
    } else fam.direct.push(r.machine);
  }
  // A family with types has no loose machines: they become its "Standard" type.
  for (const fam of families.values()) {
    if (fam.types.size && fam.direct.length) {
      fam.types.set("standard", { name: "Standard", machines: fam.direct });
      fam.direct = [];
    }
  }
  return [...families.values()]
    .map((f) => ({
      name: f.name,
      direct: f.direct,
      types: [...f.types.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const loadMachines = (models) =>
  models.Equipment.findAll({ attributes: ["equipment_id", "equipment_name", "category_id"], raw: true });

const summarise = (plan) =>
  plan.map((f) => ({
    family: f.name,
    machines: f.direct.length + f.types.reduce((n, t) => n + t.machines.length, 0),
    types: f.types.map((t) => ({ name: t.name, machines: t.machines.length })),
    direct: f.direct.length,
  }));

export const previewOrganize = async (models) => summarise(buildPlan(await loadMachines(models)));

export const applyOrganize = async (models, sequelize) => {
  const machines = await loadMachines(models);
  const plan = buildPlan(machines);
  if (!plan.length) throw new AppError("There are no machines to organize.", 400);

  return sequelize.transaction(async (transaction) => {
    const cats = await models.EquipmentCategory.findAll({ transaction });
    const find = (name, parentId) =>
      cats.find((c) => keyOf(c.category_name) === keyOf(name) && (c.parent_id ?? null) === parentId);
    const ensure = async (name, parentId) => {
      let c = find(name, parentId);
      if (!c) {
        c = await models.EquipmentCategory.create({ category_name: name, parent_id: parentId }, { transaction });
        cats.push(c);
      }
      return c;
    };

    const oldIds = new Set(machines.map((m) => m.category_id));
    const keep = new Set();
    let moved = 0;
    for (const fam of plan) {
      // An old flat category that already has the family's name is simply reused as the family.
      const parent = await ensure(fam.name, null);
      keep.add(parent.category_id);
      const assign = async (list, categoryId) => {
        const ids = list.filter((m) => m.category_id !== categoryId).map((m) => m.equipment_id);
        if (ids.length) {
          await models.Equipment.update({ category_id: categoryId }, { where: { equipment_id: ids }, transaction });
          moved += ids.length;
        }
      };
      await assign(fam.direct, parent.category_id);
      for (const t of fam.types) {
        const child = await ensure(t.name, parent.category_id);
        keep.add(child.category_id);
        await assign(t.machines, child.category_id);
      }
    }

    // Old categories this emptied are removed; ones that were already empty are left alone.
    let removed = 0;
    for (const id of oldIds) {
      if (keep.has(id)) continue;
      const left = await models.Equipment.count({ where: { category_id: id }, transaction });
      const kids = await models.EquipmentCategory.count({ where: { parent_id: id }, transaction });
      if (!left && !kids) removed += await models.EquipmentCategory.destroy({ where: { category_id: id }, transaction });
    }
    return { families: plan.length, moved, removed };
  });
};
