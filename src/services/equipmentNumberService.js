// Automatic machine numbers and names, plus the bulk add/edit grid.
//  • Number (serial_number): EQ-110, the next after the highest in use, archived machines included.
//  • Name: "Drill with Hammer - 6", the next within the machine's type (category).
// Quantity (bulk) machines have one row and no number in the name.
import { Op } from "sequelize";
import AppError from "../utils/AppError.js";

const PREFIX = "EQ-";
const MAX_ROWS = 500;
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

const serialValue = (s) => {
  const m = String(s ?? "").trim().match(/^EQ-(\d+)$/i);
  return m ? Number(m[1]) : null;
};
export const formatSerial = (n) => `${PREFIX}${String(n).padStart(3, "0")}`;

/** The number after the highest EQ-… in use. Other formats are ignored. */
export const nextSerialValue = (serials) => serials.reduce((max, s) => Math.max(max, serialValue(s) ?? 0), 0) + 1;

/** "Drill with Hammer - 5" → "Drill with Hammer". */
export const stripNameNumber = (name) => String(name ?? "").replace(/\s*[-–]\s*\d+\s*$/, "").trim();
const nameNumber = (name) => {
  const m = String(name ?? "").match(/[-–]\s*(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
};

/** The next number within a type: never below the count, never a number already used in a name. */
export const nextNameNumber = (names) => names.reduce((max, n) => Math.max(max, nameNumber(n)), names.length) + 1;

const allSerials = async (models, transaction) =>
  (await models.Equipment.findAll({ attributes: ["serial_number"], raw: true, transaction })).map((r) => r.serial_number);

/**
 * What a new machine should be called. With a type, also its usual prices and Sinhala name, taken
 * from the newest machine of that type. Sinhala is only reused when that machine has the same base
 * name, so a broad category never puts the wrong Sinhala on a bill.
 */
export const getNextEquipment = async (models, { categoryId } = {}) => {
  const out = { serial_number: formatSerial(nextSerialValue(await allSerials(models))) };
  if (!categoryId) return out;

  const category = await models.EquipmentCategory.findByPk(categoryId);
  if (!category) throw new AppError("Category not found.", 404);
  const siblings = await models.Equipment.findAll({
    where: { category_id: categoryId },
    order: [["equipment_id", "DESC"]],
    attributes: ["equipment_name", "equipment_name_si", "base_rental_price", "extra_daily_rate", "minimum_rental_days", "warehouse_id"],
    raw: true,
  });
  const latest = siblings[0];
  const base = category.category_name;
  const baseSi = siblings.find((s) => stripNameNumber(s.equipment_name) === base && s.equipment_name_si)?.equipment_name_si;
  return {
    ...out,
    name_number: nextNameNumber(siblings.map((s) => s.equipment_name)),
    base_name: base,
    base_name_si: baseSi ? stripNameNumber(baseSi) : "",
    base_rental_price: latest ? money(latest.base_rental_price) : null,
    extra_daily_rate: latest ? money(latest.extra_daily_rate) : null,
    minimum_rental_days: latest?.minimum_rental_days ?? 1,
    warehouse_id: latest?.warehouse_id ?? null,
  };
};

const blank = (v) => v === undefined || v === null || String(v).trim() === "";
const optionalNumber = (v) => (blank(v) ? null : Number(v));

/**
 * Save the grid in one go: rows with `equipment_id` update, the rest create. Everything is checked
 * first; any problem saves nothing and returns the problems per row.
 */
export const bulkSaveEquipment = async (models, rows) => {
  if (!Array.isArray(rows) || rows.length === 0) throw new AppError("Add at least one row.", 400);
  if (rows.length > MAX_ROWS) throw new AppError(`Save at most ${MAX_ROWS} rows at a time.`, 400);

  return models.sequelize.transaction(async (t) => {
    const [categories, warehouses, everyone] = await Promise.all([
      models.EquipmentCategory.findAll({ attributes: ["category_id", "category_name"], raw: true, transaction: t }),
      models.Warehouse.findAll({ attributes: ["warehouse_id"], raw: true, transaction: t }),
      models.Equipment.findAll({
        attributes: ["equipment_id", "serial_number", "equipment_name", "category_id"],
        raw: true,
        transaction: t,
        lock: t.LOCK?.UPDATE,
      }),
    ]);
    const categoryById = new Map(categories.map((c) => [Number(c.category_id), c]));
    const warehouseIds = new Set(warehouses.map((w) => Number(w.warehouse_id)));
    const defaultWarehouse = warehouses.length === 1 ? Number(warehouses[0].warehouse_id) : null;

    // Numbers kept by machines not being renumbered here.
    const editedIds = new Set(rows.filter((r) => r.equipment_id).map((r) => Number(r.equipment_id)));
    const taken = new Set(everyone.filter((e) => !editedIds.has(Number(e.equipment_id))).map((e) => String(e.serial_number).toLowerCase()));
    let nextSerial = nextSerialValue([...everyone.map((e) => e.serial_number), ...rows.map((r) => r.serial_number)]);
    const namesByCategory = new Map();
    for (const e of everyone) {
      const list = namesByCategory.get(Number(e.category_id)) || [];
      list.push(e.equipment_name);
      namesByCategory.set(Number(e.category_id), list);
    }

    const errors = [];
    const prepared = rows.map((raw, row) => {
      const fail = (field, code) => errors.push({ row, field, code });
      const categoryId = Number(raw.category_id);
      const category = categoryById.get(categoryId);
      if (!category) fail("category_id", "category_required");

      const warehouseId = Number(raw.warehouse_id) || defaultWarehouse;
      if (!warehouseIds.has(warehouseId)) fail("warehouse_id", "warehouse_required");

      const price = Number(raw.base_rental_price);
      if (blank(raw.base_rental_price) || !Number.isFinite(price) || price < 0) fail("base_rental_price", "price_required");
      const qty = blank(raw.total_owned_qty) ? 1 : Number(raw.total_owned_qty);
      if (!Number.isInteger(qty) || qty < 1) fail("total_owned_qty", "qty_invalid");
      const bulk = qty > 1 || raw.is_bulk_item === true;

      let name = String(raw.equipment_name ?? "").trim();
      if (!name && category && !raw.equipment_id) {
        const names = namesByCategory.get(categoryId) || [];
        name = bulk ? category.category_name : `${category.category_name} - ${nextNameNumber(names)}`;
        names.push(name);
        namesByCategory.set(categoryId, names);
      }
      if (name.length < 2) fail("equipment_name", "name_required");

      let serial = String(raw.serial_number ?? "").trim();
      if (!serial) {
        if (raw.equipment_id) fail("serial_number", "number_required");
        else serial = formatSerial(nextSerial++);
      }
      if (serial) {
        if (taken.has(serial.toLowerCase())) fail("serial_number", "number_taken");
        taken.add(serial.toLowerCase());
      }

      return {
        id: raw.equipment_id ? Number(raw.equipment_id) : null,
        values: {
          category_id: categoryId,
          warehouse_id: warehouseId,
          equipment_name: name,
          equipment_name_si: blank(raw.equipment_name_si) ? null : String(raw.equipment_name_si).trim(),
          serial_number: serial,
          base_rental_price: money(price),
          extra_daily_rate: blank(raw.extra_daily_rate) ? money(price) : money(raw.extra_daily_rate),
          minimum_rental_days: blank(raw.minimum_rental_days) ? 1 : Number(raw.minimum_rental_days) || 1,
          purchase_cost: optionalNumber(raw.purchase_cost),
          warranty_period_months: optionalNumber(raw.warranty_period_months),
          end_of_warranty_date: blank(raw.end_of_warranty_date) ? null : raw.end_of_warranty_date,
          is_bulk_item: bulk,
        },
        qty,
        row,
      };
    });
    if (errors.length) return { saved: false, errors };

    const existing = editedIds.size
      ? await models.Equipment.findAll({ where: { equipment_id: { [Op.in]: [...editedIds] } }, transaction: t, lock: t.LOCK?.UPDATE })
      : [];
    const byId = new Map(existing.map((e) => [Number(e.equipment_id), e]));
    for (const p of prepared) {
      if (!p.id) continue;
      const machine = byId.get(p.id);
      if (!machine) errors.push({ row: p.row, field: "equipment_name", code: "machine_missing" });
      else if (p.qty < Number(machine.rented_qty) + Number(machine.defective_qty)) errors.push({ row: p.row, field: "total_owned_qty", code: "qty_below_out" });
    }
    if (errors.length) return { saved: false, errors };

    const saved = [];
    for (const p of prepared) {
      if (p.id) {
        const machine = byId.get(p.id);
        await machine.update(
          { ...p.values, total_owned_qty: p.qty, available_qty: p.qty - Number(machine.rented_qty) - Number(machine.defective_qty) },
          { transaction: t },
        );
        saved.push({ row: p.row, equipment_id: p.id, serial_number: p.values.serial_number, equipment_name: p.values.equipment_name });
      } else {
        const created = await models.Equipment.create(
          { ...p.values, total_owned_qty: p.qty, available_qty: p.qty, rented_qty: 0, defective_qty: 0 },
          { transaction: t },
        );
        saved.push({ row: p.row, equipment_id: created.equipment_id, serial_number: p.values.serial_number, equipment_name: p.values.equipment_name });
      }
    }
    return { saved: true, rows: saved };
  });
};
