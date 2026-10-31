// ─────────────────────────────────────────────────────────────────────────────
// One-off correction: machines rented with no return date were priced for 1 day and, before the
// elapsed-time billing fix, never charged for the extra days they stayed out.
//
//   node src/scripts/fixExtraDayCharges.js                  DRY RUN: list what would change (writes nothing)
//   node src/scripts/fixExtraDayCharges.js --apply          Apply the corrections
//   node src/scripts/fixExtraDayCharges.js --invoice=54     Limit to one invoice id
//
// Per returned line, per handover (RETURN_PROCESSED trace): extra days (elapsed time since the bill,
// rounded up, minus the days the locked price covers) x extra daily rate x units returned. The
// difference to what the line already carries is added to the line and the invoice total, and an
// EXTRA_DAYS_CORRECTION trace records it. Re-running is safe: it works from the current line total.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { QueryTypes } from "sequelize";
import { masterSequelize, getTenantConnection } from "../config/database.js";
import { lineOutMoment, openEndedExtraDays } from "../services/invoiceService.js";

const apply = process.argv.includes("--apply");
const onlyInvoice = (process.argv.find((a) => a.startsWith("--invoice=")) || "").split("=")[1];

const parse = (v) => {
  if (!v) return {};
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
};

const run = async () => {
  const tenants = await masterSequelize.query(
    "SELECT db_name, db_user, encrypted_db_pass, db_host FROM TENANTS",
    { type: QueryTypes.SELECT },
  );
  let totalDelta = 0;
  let totalLines = 0;

  for (const tenant of tenants) {
    const conn = await getTenantConnection(tenant.db_name, tenant.db_user, tenant.encrypted_db_pass, tenant.db_host);
    const lines = await conn.query(
      `SELECT il.*, i.issued_date, i.status AS invoice_status
         FROM INVOICE_LINES il JOIN INVOICES i ON i.invoice_id = il.invoice_id
        WHERE i.is_deleted = 0
          AND il.track_overdue = 0
          AND il.expected_return_date = il.borrow_date
          AND (il.good_returned_qty + il.defective_returned_qty) > 0
          ${onlyInvoice ? "AND il.invoice_id = :onlyInvoice" : ""}
        ORDER BY il.invoice_id, il.line_id`,
      { type: QueryTypes.SELECT, replacements: { onlyInvoice } },
    );

    const fixes = [];
    for (const line of lines) {
      const traces = await conn.query(
        "SELECT * FROM INVOICE_TRACE WHERE invoice_id = :id AND event_action = 'RETURN_PROCESSED' ORDER BY occurred_at, trace_id",
        { type: QueryTypes.SELECT, replacements: { id: line.invoice_id } },
      );
      const out = lineOutMoment(line, line.issued_date);
      let needed = 0;
      let handovers = 0;
      for (const tr of traces) {
        const rl = (parse(tr.state_payload).lines_returned || []).find((l) => Number(l.line_id) === Number(line.line_id));
        const qty = rl ? (Number(rl.good_qty) || 0) + (Number(rl.defective_qty) || 0) : 0;
        if (qty <= 0) continue;
        handovers++;
        needed += openEndedExtraDays(line, out, tr.occurred_at || tr.createdAt) * Number(line.locked_extra_daily_rate) * qty;
      }
      if (!handovers) continue;
      const charged = Math.max(0, Number(line.line_total_amount) - Number(line.locked_base_price) * Number(line.borrow_quantity));
      const delta = Math.round((needed - charged) * 100) / 100;
      if (delta > 0) fixes.push({ line, delta, needed, charged });
    }

    if (!fixes.length) continue;
    console.log(`\n── ${tenant.db_name}`);
    for (const f of fixes) {
      console.log(
        `INV-${f.line.invoice_id} line ${f.line.line_id} [${f.line.invoice_status}]: line total ${f.line.line_total_amount} -> ${Number(f.line.line_total_amount) + f.delta} (+${f.delta})`,
      );
    }
    totalDelta += fixes.reduce((s, f) => s + f.delta, 0);
    totalLines += fixes.length;

    if (apply) {
      await conn.transaction(async (t) => {
        const perInvoice = new Map();
        for (const f of fixes) {
          await conn.query("UPDATE INVOICE_LINES SET line_total_amount = line_total_amount + :d WHERE line_id = :id", {
            replacements: { d: f.delta, id: f.line.line_id },
            transaction: t,
          });
          perInvoice.set(f.line.invoice_id, (perInvoice.get(f.line.invoice_id) || 0) + f.delta);
        }
        for (const [invoiceId, d] of perInvoice) {
          await conn.query("UPDATE INVOICES SET total_amount = total_amount + :d WHERE invoice_id = :id", {
            replacements: { d, id: invoiceId },
            transaction: t,
          });
          await conn.query(
            `INSERT INTO INVOICE_TRACE (invoice_id, event_category, event_action, comments, occurred_at, createdAt, updatedAt)
             VALUES (:id, 'SETTLEMENT', 'EXTRA_DAYS_CORRECTION', :c, NOW(), NOW(), NOW())`,
            {
              replacements: { id: invoiceId, c: `Added Rs.${d} for days the machines were kept beyond the 1-day price (billing fix).` },
              transaction: t,
            },
          );
        }
      });
      console.log(`   applied.`);
    }
  }
  console.log(`\n${apply ? "APPLIED" : "DRY RUN"}: ${totalLines} line(s), total +Rs.${totalDelta}`);
  process.exit(0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
