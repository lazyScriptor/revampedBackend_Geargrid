// migrations/tenant/20260526000003-repair-existing-print-logs.js
// Cleans up synthetic verification test logs and backfills normalized snapshot & staff attribution
// fields on existing INVOICE_PRINT_LOGS rows so historical bill snapshots render completely.

export const up = async ({ context: queryInterface }) => {
  const sequelize = queryInterface.sequelize;

  try {
    const [tables] = await sequelize.query("SHOW TABLES");
    const tableNames = tables.map((t) => Object.values(t)[0]);
    const logTable =
      tableNames.find((t) => t.toLowerCase() === "invoice_print_logs") ||
      "INVOICE_PRINT_LOGS";
    const userTable =
      tableNames.find((t) => t.toLowerCase() === "users") || "USERS";
    const traceTable =
      tableNames.find((t) => t.toLowerCase() === "invoice_trace") ||
      "INVOICE_TRACE";

    // 1. Remove synthetic curl verification record if present
    await sequelize.query(
      `DELETE FROM \`${logTable}\` WHERE doc_number = 'TEST-LIVE-PRINT' AND customer_name = 'Verification Customer'`
    );

    // 2. Backfill full staff names & normalized bill_snapshot fields on existing print logs
    const [logs] = await sequelize.query(`SELECT * FROM \`${logTable}\``);
    const [users] = await sequelize.query(
      `SELECT user_id, username, first_name, last_name FROM \`${userTable}\``
    );
    const userMap = new Map(users.map((u) => [Number(u.user_id), u]));

    for (const log of logs) {
      const u = userMap.get(Number(log.printed_by_user_id));
      let newPrintedByName = log.printed_by_name;
      if (u) {
        const fullName = `${u.first_name || ""} ${u.last_name || ""}`.trim();
        if (fullName && u.username) {
          newPrintedByName = `${fullName} (${u.username})`;
        } else if (fullName) {
          newPrintedByName = fullName;
        }
      }

      let snap = log.bill_snapshot;
      if (typeof snap === "string") {
        try {
          snap = JSON.parse(snap);
        } catch {
          snap = null;
        }
      }

      if (snap && typeof snap === "object") {
        const cust = snap.Customer || snap.customer || null;
        const lines = snap.InvoiceLines || snap.items || [];
        const subtotal = Number(snap.sub_total ?? snap.fees?.subtotal ?? log.subtotal ?? 0);
        const transport = Number(snap.transport_fee ?? snap.fees?.transportFee ?? log.transport_fee ?? 0);
        const discount = Number(snap.discount_amount ?? snap.fees?.discountAmount ?? log.discount_amount ?? 0);
        const grandTotal = Number(snap.total_amount ?? snap.fees?.grandTotal ?? log.grand_total ?? 0);
        const totalPaid = Number(snap.fees?.totalPaid ?? log.total_paid ?? 0);
        const balanceDue = Number(snap.fees?.balanceDue ?? log.balance_due ?? 0);

        snap = {
          ...snap,
          invoice_id: snap.invoice_id || log.invoice_id,
          doc_number: snap.doc_number || log.doc_number,
          status: snap.status || (log.doc_type === "COMPLETED" ? "Completed" : "Active"),
          issued_date: snap.issued_date || log.printed_at,
          Customer: cust,
          customer: cust,
          InvoiceLines: lines,
          items: lines,
          sub_total: subtotal,
          transport_fee: transport,
          discount_amount: discount,
          total_amount: grandTotal,
          fees: {
            ...(snap.fees || {}),
            subtotal,
            transportFee: transport,
            discountAmount: discount,
            grandTotal,
            totalPaid,
            balanceDue,
            transport,
            discount,
            advance: totalPaid,
          },
        };
      }

      await sequelize.query(
        `UPDATE \`${logTable}\` SET printed_by_name = :printedByName, bill_snapshot = :billSnapshot WHERE log_id = :logId`,
        {
          replacements: {
            printedByName: newPrintedByName,
            billSnapshot: snap ? JSON.stringify(snap) : null,
            logId: log.log_id,
          },
        }
      );
    }

    // 3. Also update comments in INVOICE_TRACE for RECEIPT_PRINTED events
    if (traceTable) {
      for (const u of users) {
        const fullName = `${u.first_name || ""} ${u.last_name || ""}`.trim();
        if (fullName && u.username) {
          await sequelize.query(
            `UPDATE \`${traceTable}\` SET comments = REPLACE(comments, :oldName, :newName) WHERE event_action = 'RECEIPT_PRINTED' AND actor_user_id = :userId`,
            {
              replacements: {
                oldName: `printed by ${u.username} `,
                newName: `printed by ${fullName} (${u.username}) `,
                userId: u.user_id,
              },
            }
          );
        }
      }
    }
  } catch (err) {
    console.warn("Non-fatal notice in 20260526000003-repair-existing-print-logs:", err.message);
  }
};

export const down = async () => {
  // No-op rollback
};
