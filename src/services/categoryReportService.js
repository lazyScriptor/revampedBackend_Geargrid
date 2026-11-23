// Equipment performance rolled up by family -> type -> machine.
// Money and units use the shared helpers in utils/invoiceBalance.js:
//   revenue = what the rental lines come to so far (billed + extra days for machines still out),
//   units out = borrowed minus returned (so part returns count as still out).
// Voided payments don't matter here: revenue is the value of the rentals, not cash taken.
import { Op } from "sequelize";
import { parseTenantDayRange } from "../utils/dateRange.js";
import { liveLineTotalExpr, unitsOutExpr, lineStillOutSql } from "../utils/invoiceBalance.js";

const num = (v) => Number(v) || 0;
const money = (v) => Math.round(num(v) * 100) / 100;
const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

const emptyTotals = () => ({
  machines: 0, units: 0, revenue: 0, rentals: 0, daysRented: 0, capacityDays: 0,
  idleMachines: 0, unitsOut: 0, defects: 0, purchaseCost: 0, lifetimeRevenue: 0,
});

const addTo = (t, m) => {
  t.machines += 1;
  t.units += m.owned;
  t.revenue += m.revenue;
  t.rentals += m.rentals;
  t.daysRented += m.daysRented;
  t.capacityDays += m.capacityDays;
  t.idleMachines += m.idle ? 1 : 0;
  t.unitsOut += m.unitsOut;
  t.defects += m.defects;
  t.purchaseCost += m.purchaseCost;
  t.lifetimeRevenue += m.lifetimeRevenue;
};

const finish = (t) => ({
  ...t,
  revenue: money(t.revenue),
  purchaseCost: money(t.purchaseCost),
  lifetimeRevenue: money(t.lifetimeRevenue),
  utilizationPct: pct(t.daysRented, t.capacityDays),
  paybackPct: t.purchaseCost > 0 ? Math.round((t.lifetimeRevenue / t.purchaseCost) * 100) : null,
});

/** Machines (one row each) with their figures for the date range. */
const loadMachines = async (models, { start, end, warehouseId, categoryIds }) => {
  const where = ["e.is_archived = 0"];
  const repl = { rangeStart: start, rangeEnd: end };
  if (warehouseId) { where.push("e.warehouse_id = :warehouseId"); repl.warehouseId = warehouseId; }
  if (categoryIds?.length) { where.push("e.category_id IN (:categoryIds)"); repl.categoryIds = categoryIds; }

  return models.sequelize.query(
    `SELECT e.equipment_id, e.equipment_name, e.serial_number, e.category_id, e.purchase_cost,
            e.total_owned_qty, w.location_name AS warehouse,
            COALESCE(r.revenue, 0) AS revenue, COALESCE(r.rentals, 0) AS rentals,
            COALESCE(r.days_rented, 0) AS days_rented,
            COALESCE(l.lifetime_revenue, 0) AS lifetime_revenue,
            COALESCE(o.units_out, 0) AS units_out,
            COALESCE(d.defects, 0) AS defects
       FROM EQUIPMENT e
       LEFT JOIN WAREHOUSES w ON w.warehouse_id = e.warehouse_id
       LEFT JOIN (
         SELECT il.equipment_id, SUM(${liveLineTotalExpr()}) AS revenue,
                COUNT(DISTINCT il.invoice_id) AS rentals,
                SUM(GREATEST(1, DATEDIFF(COALESCE(il.actual_return_date, il.expected_return_date), il.borrow_date)) * il.borrow_quantity) AS days_rented
           FROM INVOICE_LINES il JOIN INVOICES i ON i.invoice_id = il.invoice_id AND i.is_deleted = 0
          WHERE i.issued_date BETWEEN :rangeStart AND :rangeEnd GROUP BY il.equipment_id
       ) r ON r.equipment_id = e.equipment_id
       LEFT JOIN (
         SELECT il.equipment_id, SUM(${liveLineTotalExpr()}) AS lifetime_revenue
           FROM INVOICE_LINES il JOIN INVOICES i ON i.invoice_id = il.invoice_id AND i.is_deleted = 0
          GROUP BY il.equipment_id
       ) l ON l.equipment_id = e.equipment_id
       LEFT JOIN (
         SELECT il.equipment_id, SUM(${unitsOutExpr()}) AS units_out
           FROM INVOICE_LINES il JOIN INVOICES i ON i.invoice_id = il.invoice_id AND i.is_deleted = 0
          WHERE ${lineStillOutSql()} GROUP BY il.equipment_id
       ) o ON o.equipment_id = e.equipment_id
       LEFT JOIN (
         SELECT equipment_id, COUNT(*) AS defects FROM DEFECT_LOGS
          WHERE reported_date BETWEEN :rangeStart AND :rangeEnd GROUP BY equipment_id
       ) d ON d.equipment_id = e.equipment_id
      WHERE ${where.join(" AND ")}`,
    { replacements: repl, type: models.sequelize.constructor.QueryTypes.SELECT },
  );
};

export const getEquipmentPerformance = async (models, filters = {}) => {
  const { start, end, startYmd, endYmd } = parseTenantDayRange(filters.startDate, filters.endDate, filters.tenantTz);
  const days = Math.max(1, Math.ceil((end - start) / 86400000));
  const warehouseId = filters.warehouseId ? Number(filters.warehouseId) : null;

  const cats = await models.EquipmentCategory.findAll({ raw: true });
  const byId = new Map(cats.map((c) => [c.category_id, c]));

  // Picking a family includes its types.
  let categoryIds = null;
  if (filters.categoryId) {
    const id = Number(filters.categoryId);
    categoryIds = [id, ...cats.filter((c) => c.parent_id === id).map((c) => c.category_id)];
  }

  const raw = await loadMachines(models, { start, end, warehouseId, categoryIds });
  const machines = raw.map((r) => {
    const owned = Math.max(1, parseInt(r.total_owned_qty) || 1);
    const daysRented = num(r.days_rented);
    const cost = num(r.purchase_cost);
    const lifetime = num(r.lifetime_revenue);
    return {
      equipment_id: r.equipment_id, name: r.equipment_name, serial: r.serial_number || null,
      category_id: r.category_id, warehouse: r.warehouse || null, owned,
      revenue: money(r.revenue), rentals: num(r.rentals), daysRented,
      capacityDays: days * owned,
      utilizationPct: pct(daysRented, days * owned),
      unitsOut: num(r.units_out), defects: num(r.defects),
      purchaseCost: cost, lifetimeRevenue: money(lifetime),
      paybackPct: cost > 0 ? Math.round((lifetime / cost) * 100) : null,
      idle: num(r.rentals) === 0,
    };
  });

  // family -> type -> machines. A machine sits in its category; if that category has a parent, the parent is the family.
  const families = new Map();
  const famFor = (cat) => {
    const fam = cat?.parent_id ? byId.get(cat.parent_id) : cat;
    const id = fam?.category_id ?? 0;
    if (!families.has(id)) families.set(id, { category_id: id || null, name: fam?.category_name ?? "Uncategorized", t: emptyTotals(), types: new Map(), direct: [] });
    return families.get(id);
  };
  for (const m of machines) {
    const cat = byId.get(m.category_id);
    const fam = famFor(cat);
    addTo(fam.t, m);
    if (cat?.parent_id) {
      if (!fam.types.has(cat.category_id)) fam.types.set(cat.category_id, { category_id: cat.category_id, name: cat.category_name, t: emptyTotals(), machines: [] });
      const type = fam.types.get(cat.category_id);
      addTo(type.t, m);
      type.machines.push(m);
    } else fam.direct.push(m);
  }

  const total = emptyTotals();
  machines.forEach((m) => addTo(total, m));

  // Repair spend is recorded per warehouse, not per machine, so it is shown for the whole fleet.
  const repair = await models.Expense.sum("amount", {
    where: { category: "Repair", date: { [Op.between]: [start, end] }, ...(warehouseId ? { warehouse_id: warehouseId } : {}) },
  });

  const out = [...families.values()]
    .map((f) => ({
      category_id: f.category_id, name: f.name, ...finish(f.t),
      machinesList: f.direct,
      types: [...f.types.values()]
        .map((t) => ({ category_id: t.category_id, name: t.name, ...finish(t.t), machinesList: t.machines }))
        .sort((a, b) => b.revenue - a.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    dateRange: { startDate: startYmd, endDate: endYmd, days },
    totals: { ...finish(total), repairCost: money(repair) },
    families: out,
    topEarners: [...machines].sort((a, b) => b.revenue - a.revenue).filter((m) => m.revenue > 0).slice(0, 10),
    idleMachines: machines.filter((m) => m.idle).sort((a, b) => b.purchaseCost - a.purchaseCost).slice(0, 50),
  };
};
