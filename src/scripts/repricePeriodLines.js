// ─────────────────────────────────────────────────────────────────────────────
// One-off correction: bills written while a period item (e.g. scaffolding, Rs. 250 for up to 5 days,
// then Rs. 50 a day) was saved with the wrong prices (base Rs. 50, or "Rs. 50 a day") keep those
// prices, because each line locks its prices when the bill is written. This re-prices those lines
// with the equipment's CURRENT prices and the period rule, and moves the invoice totals by the difference.
//
//   node src/scripts/repricePeriodLines.js                 DRY RUN: list what would change (writes nothing)
//   node src/scripts/repricePeriodLines.js --apply         Apply the corrections
//   node src/scripts/repricePeriodLines.js --invoice=104   Limit to one invoice id
//
// Only lines of invoices that are not deleted and not Completed, whose equipment now has a minimum
// period of more than 1 day and whose locked prices differ from the equipment's. Payments and
// deposits are not touched: the balance owed changes. Every changed invoice gets a PRICE_CORRECTION
// trace. Re-running is safe: corrected lines match the equipment and are skipped.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { QueryTypes } from "sequelize";
import { chargeableLateDays, contractDays, isOpenEndedLine, lineOutMoment, openEndedExtraDays, periodCharge } from "../utils/rentalDays.js";

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const parse = (v) => {
  if (!v) return {};
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
};

/**
 * Pure: what a line should have been billed with `prices`, from its handovers.
 * handovers: [{ qty, at (moment), date ("YYYY-MM-DD"), waived }]
 * Returns { lineTotal, dispatch, late } — `late` is the part outside the subtotal (late fees on
 * tracked lines); everything else is rental.
 */
export const repriceLine = (line, prices, handovers, issuedAt) => {
  const l = { ...line, locked_base_price: prices.base, locked_minimum_days: prices.minDays, locked_extra_daily_rate: prices.rate };
  const qty = Number(l.borrow_quantity) || 0;
  const openEnded = isOpenEndedLine(l);
  const dispatch = periodCharge({ base: prices.base, minDays: prices.minDays, rate: prices.rate, days: openEnded ? 1 : contractDays(l), qty });
  let extra = 0;
  let late = 0;
  for (const h of handovers) {
    if (!(h.qty > 0)) continue;
    if (openEnded) extra += openEndedExtraDays(l, lineOutMoment(l, issuedAt), h.at) * prices.rate * h.qty;
    else if (!h.waived) late += chargeableLateDays(l, h.date) * prices.rate * h.qty;
  }
  return { lineTotal: money(dispatch + extra + late), dispatch: money(dispatch + extra), late: money(late) };
};

const run = async () => {
  const apply = process.argv.includes("--apply");
  const onlyInvoice = (process.argv.find((a) => a.startsWith("--invoice=")) || "").split("=")[1];
  const { masterSequelize, getTenantConnection } = await import("../config/database.js");
  const { initTenantModels } = await import("../models/index.js");
  const { refreshAccruals } = await import("../services/accrualService.js");

  const tenants = await masterSequelize.query("SELECT db_name, db_user, encrypted_db_pass, db_host FROM TENANTS", { type: QueryTypes.SELECT });
  let grand = 0;
  let count = 0;

  for (const tenant of tenants) {
    let conn;
    try {
      conn = await getTenantConnection(tenant.db_name, tenant.db_user, tenant.encrypted_db_pass, tenant.db_host);
    } catch (e) {
      console.log(`\n── ${tenant.db_name}: cannot connect (${e.message}), skipped`);
      continue;
    }
    const q = (sql, replacements = {}) => conn.query(sql, { type: QueryTypes.SELECT, replacements });

    // Period equipment whose base price looks like a per-day price: re-pricing would copy that mistake.
    const suspicious = await q(
      `SELECT serial_number, equipment_name, base_rental_price, minimum_rental_days, extra_daily_rate FROM EQUIPMENT
        WHERE minimum_rental_days > 1 AND base_rental_price <= extra_daily_rate AND is_archived = 0`,
    );

    const rows = await q(
      `SELECT il.*, i.issued_date, i.status AS invoice_status, e.serial_number, e.equipment_name,
              e.base_rental_price AS eq_base, e.minimum_rental_days AS eq_min, e.extra_daily_rate AS eq_rate
         FROM INVOICE_LINES il
         JOIN INVOICES i ON i.invoice_id = il.invoice_id
         JOIN EQUIPMENT e ON e.equipment_id = il.equipment_id
        WHERE i.is_deleted = 0 AND i.status <> 'Completed'
          AND e.minimum_rental_days > 1
          AND (il.locked_base_price <> e.base_rental_price OR il.locked_minimum_days <> e.minimum_rental_days
               OR il.locked_extra_daily_rate <> e.extra_daily_rate)
          ${onlyInvoice ? "AND il.invoice_id = :onlyInvoice" : ""}
        ORDER BY il.invoice_id, il.line_id`,
      { onlyInvoice },
    );
    const completed = await q(
      `SELECT DISTINCT il.invoice_id FROM INVOICE_LINES il JOIN INVOICES i ON i.invoice_id = il.invoice_id
         JOIN EQUIPMENT e ON e.equipment_id = il.equipment_id
        WHERE i.is_deleted = 0 AND i.status = 'Completed' AND e.minimum_rental_days > 1
          AND (il.locked_base_price <> e.base_rental_price OR il.locked_minimum_days <> e.minimum_rental_days
               OR il.locked_extra_daily_rate <> e.extra_daily_rate)`,
    );
    if (!rows.length && !suspicious.length && !completed.length) continue;
    console.log(`\n── ${tenant.db_name}`);
    for (const s of suspicious) {
      console.log(`  ⚠ ${s.serial_number} ${s.equipment_name}: base ${s.base_rental_price} for ${s.minimum_rental_days} days, then ${s.extra_daily_rate}/day — base looks like a daily price; fix the equipment first`);
    }
    if (completed.length) console.log(`  (not changed — Completed invoices with old prices: ${completed.map((c) => `INV-${c.invoice_id}`).join(", ")})`);

    const fixes = [];
    for (const line of rows) {
      const traces = await q(
        "SELECT * FROM INVOICE_TRACE WHERE invoice_id = :id AND event_action = 'RETURN_PROCESSED' ORDER BY occurred_at, trace_id",
        { id: line.invoice_id },
      );
      const handovers = [];
      for (const tr of traces) {
        const rl = (parse(tr.state_payload).lines_returned || []).find((x) => Number(x.line_id) === Number(line.line_id));
        const qty = rl ? (Number(rl.good_qty) || 0) + (Number(rl.defective_qty) || 0) : 0;
        if (qty > 0) handovers.push({ qty, at: rl.actual_return_at || tr.occurred_at || tr.createdAt, date: rl.actual_return_date, waived: rl.track_overdue === false });
      }
      const prices = { base: Number(line.eq_base), minDays: Number(line.eq_min), rate: Number(line.eq_rate) };
      const now = repriceLine(line, prices, handovers, line.issued_date);
      // What the old line carried: dispatch part (old prices) and, for tracked lines, the late fees on top.
      const oldTotal = money(line.line_total_amount);
      const oldDispatch = isOpenEndedLine(line)
        ? oldTotal
        : money(Math.min(oldTotal, periodCharge({ base: line.locked_base_price, minDays: line.locked_minimum_days, rate: line.locked_extra_daily_rate, days: contractDays(line), qty: line.borrow_quantity })));
      const delta = money(now.lineTotal - oldTotal);
      const subDelta = money(now.dispatch - oldDispatch);
      fixes.push({ line, prices, now, oldTotal, delta, subDelta });
      console.log(
        `  INV-${line.invoice_id} [${line.invoice_status}] ${line.serial_number} ${line.equipment_name} ×${line.borrow_quantity}: ` +
          `${money(line.locked_base_price)}/${line.locked_minimum_days}d/${money(line.locked_extra_daily_rate)} → ${prices.base}/${prices.minDays}d/${prices.rate}; ` +
          `line ${oldTotal} → ${now.lineTotal} (${delta >= 0 ? "+" : ""}${delta})`,
      );
    }
    grand += fixes.reduce((s, f) => s + f.delta, 0);
    count += fixes.length;

    if (apply && fixes.length) {
      const models = initTenantModels(conn);
      await conn.transaction(async (t) => {
        const perInvoice = new Map();
        for (const f of fixes) {
          await conn.query(
            `UPDATE INVOICE_LINES SET locked_base_price = :b, locked_minimum_days = :m, locked_extra_daily_rate = :r, line_total_amount = :tot
              WHERE line_id = :id`,
            { replacements: { b: f.prices.base, m: f.prices.minDays, r: f.prices.rate, tot: f.now.lineTotal, id: f.line.line_id }, transaction: t },
          );
          const p = perInvoice.get(f.line.invoice_id) || { total: 0, sub: 0, notes: [] };
          p.total += f.delta;
          p.sub += f.subDelta;
          p.notes.push(`${f.line.serial_number} ${f.oldTotal}→${f.now.lineTotal}`);
          perInvoice.set(f.line.invoice_id, p);
        }
        for (const [invoiceId, p] of perInvoice) {
          await conn.query("UPDATE INVOICES SET total_amount = total_amount + :d, sub_total = sub_total + :s WHERE invoice_id = :id", {
            replacements: { d: money(p.total), s: money(p.sub), id: invoiceId },
            transaction: t,
          });
          await conn.query(
            `INSERT INTO INVOICE_TRACE (invoice_id, event_category, event_action, comments, occurred_at, createdAt, updatedAt)
             VALUES (:id, 'SETTLEMENT', 'PRICE_CORRECTION', :c, NOW(), NOW(), NOW())`,
            {
              replacements: { id: invoiceId, c: `Re-priced with the period rate (pricing fix): ${p.notes.join(", ")}. Total ${p.total >= 0 ? "+" : ""}Rs.${money(p.total)}.` },
              transaction: t,
            },
          );
        }
        // Running charges of units still out follow the new prices.
        await refreshAccruals(models, { invoiceIds: [...perInvoice.keys()], transaction: t });
      });
      console.log("  applied.");
    }
  }
  console.log(`\n${apply ? "APPLIED" : "DRY RUN (nothing written)"}: ${count} line(s), invoice totals ${grand >= 0 ? "+" : ""}Rs.${money(grand)}`);
  process.exit(0);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
