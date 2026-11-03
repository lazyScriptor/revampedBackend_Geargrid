// Automatic machine numbers and names, plus the bulk add/edit grid.
//  • Number (serial_number): EQ-110, the next after the highest in use, archived machines included.
//  • Name: pick an existing machine; the new name is its text with the next number, written in that
//    machine's own format ("Drill - 6", "Drill-06", "6 - Drill"...). The highest number comes from
//    every machine with exactly the same text, archived ones included.
import { Op } from "sequelize";
import AppError from "../utils/AppError.js";

const PREFIX = "EQ-";
const MAX_ROWS = 500;
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

const serialValue = (s) => {
  const m = String(s ?? "").trim().match(/^EQ\s*-\s*(\d+)$/i);
  return m ? Number(m[1]) : null;
};
export const formatSerial = (n) => `${PREFIX}${String(n).padStart(3, "0")}`;

/** The number after the highest EQ-… in use. Other formats are ignored. */
export const nextSerialValue = (serials) => serials.reduce((max, s) => Math.max(max, serialValue(s) ?? 0), 0) + 1;

// Keep these name rules the same as revampedFrontend/src/features/equipment/lib/equipmentNumbering.ts.
const SEPARATORS = "\\s\\-–—_.:#/,";
const EDGES = new RegExp(`^[${SEPARATORS}]+|[${SEPARATORS}]+$`, "g");
const clean = (s) => s.replace(EDGES, "");
const cleanBefore = (s) => clean(clean(s.replace(/\s*\(\s*$/, "")).replace(/(^|[\s\-–—_])(?:no|num|number)\.?$/i, "$1"));

/**
 * Find a name's number and the text around it. A size is not a number: "Grinder 4 inch", "Bit 1/2"
 * and "Bolt M10" have none.
 */
export const parseName = (name) => {
  const s = String(name ?? "").trim();
  const m =
    s.match(/^(.*\(\s*)(\d+)(\s*\))$/su) ||
    s.match(/^(.*[^\p{L}\p{M}\d])(\d+)()$/su) ||
    s.match(/^((?:no\.?\s*|#\s*)?)(\d+)(\s*[-–—.:)_/]\s*)(?=[^\s\d])(.*)$/isu) ||
    s.match(/^((?:no\.?\s*|#\s*))(\d+)(\s+)(.+)$/isu) ||
    s.match(/^(.+?\s[-–—]\s*)(\d+)(\s*[-–—(].*)$/su);
  const sized = m && /\d[.,/:]$/.test(m[1]);
  // "Chainsaw 445" is a model; a machine number that large would have a separator.
  const model = m && m[2].length >= 3 && !m[2].startsWith("0") && /[\p{L}\p{M}\d)]\s+$/u.test(m[1]) && !/(?:^|\s)(?:no|num|number)\.?\s+$/i.test(m[1]);
  const before = m && !sized && !model ? m[1] : null;
  const after = before === null ? "" : `${m[3]}${m[4] ?? ""}`;
  const leftText = before === null ? clean(s) : cleanBefore(before);
  const rightText = clean(after.replace(/^\s*\)/, ""));
  const text = [leftText, rightText].filter(Boolean).join(" ");
  if (before !== null && !text) return { before: null, digits: "", after: "", number: null, text: s, key: s.toLowerCase() };
  return {
    before,
    digits: before === null ? "" : m[2],
    after,
    number: before === null ? null : Number(m[2]),
    leftText,
    text,
    key: (leftText ? `${leftText}|${rightText}` : `${rightText}|`).toLowerCase().replace(/\s+/g, " "),
  };
};

const padded = (digits, n) => (digits.length > 1 && digits.startsWith("0") ? String(n).padStart(digits.length, "0") : String(n));

/** Same format, new number. A name without a number gets " - n". */
export const renumberName = (parsed, n) =>
  parsed.before === null ? `${parsed.text} - ${n}` : `${parsed.before}${padded(parsed.digits, n)}${parsed.after}`;

/** Other text in the format of `like`: a Sinhala name that has no number of its own. */
export const nameInFormat = (like, text, n) => {
  if (like.before === null) return `${text} - ${n}`;
  const num = padded(like.digits, n);
  if (!like.leftText) return `${like.before}${num}${like.after.match(/^[^\p{L}\p{M}\d]*/u)[0]}${text}`;
  const sep = like.before.slice(like.before.lastIndexOf(like.leftText) + like.leftText.length);
  return `${text}${sep}${num}${/[\p{L}\d]/u.test(like.after) ? "" : like.after}`;
};

/**
 * What a new machine should be called. With `likeId`, also the next name, Sinhala name, prices and
 * category, taken from that machine.
 */
export const getNextEquipment = async (models, { likeId } = {}) => {
  const all = await models.Equipment.findAll({
    attributes: ["equipment_id", "serial_number", "equipment_name", "equipment_name_si", "category_id", "warehouse_id", "base_rental_price", "extra_daily_rate", "minimum_rental_days", "is_bulk_item", "total_owned_qty"],
    raw: true,
  });
  const out = { serial_number: formatSerial(nextSerialValue(all.map((m) => m.serial_number))) };
  if (!likeId) return out;

  const picked = all.find((m) => Number(m.equipment_id) === Number(likeId));
  if (!picked) throw new AppError("Equipment not found.", 404);
  const name = parseName(picked.equipment_name);
  const same = all
    .map((m) => ({ machine: m, parsed: parseName(m.equipment_name) }))
    .filter((m) => m.parsed.key === name.key)
    .sort((a, b) => Number(b.machine.equipment_id) - Number(a.machine.equipment_id));

  const highest = same.reduce((best, m) => ((m.parsed.number ?? 1) > (best.parsed.number ?? 1) ? m : best), same[0]);
  const n = (highest.parsed.number ?? 1) + 1;
  const format = name.before !== null ? name : highest.parsed;

  const si = picked.equipment_name_si || same.find((m) => m.machine.equipment_name_si)?.machine.equipment_name_si || "";
  const parsedSi = parseName(si);
  return {
    ...out,
    name_number: n,
    equipment_name: renumberName(format, n),
    equipment_name_si: !si ? "" : parsedSi.before !== null ? renumberName(parsedSi, n) : nameInFormat(format, si, n),
    base_name: name.text,
    base_name_si: si ? parsedSi.text : "",
    category_id: picked.category_id,
    warehouse_id: picked.warehouse_id,
    base_rental_price: money(picked.base_rental_price),
    extra_daily_rate: money(picked.extra_daily_rate),
    minimum_rental_days: picked.minimum_rental_days ?? 1,
    is_bulk_item: !!picked.is_bulk_item,
    total_owned_qty: picked.total_owned_qty ?? 1,
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
        attributes: ["equipment_id", "serial_number"],
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

      const name = String(raw.equipment_name ?? "").trim();
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
