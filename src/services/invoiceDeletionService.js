import { Op } from "sequelize";
import AppError from "../utils/AppError.js";
import { createNotification } from "./notificationService.js";

/**
 * Invoice soft-delete / restore.
 *
 * Business rules
 *  • Delete = "void with a reason". Nothing is ever hard-deleted.
 *  • Reason is mandatory ("Other" also needs a note).
 *  • Cashier (permission invoice:delete): only invoices with NO money on them.
 *    Admin (invoice:delete:any or full access): any invoice.
 *  • Equipment still out on rent goes back into stock; wallet deposits are credited back;
 *    other payments are marked voided (kept for reconciliation, excluded from revenue).
 *  • Deletions by someone without invoice:delete:any are flagged and the admins are notified.
 *  • Restore (invoice:restore): re-takes stock (refused if it is no longer available),
 *    un-voids the payments and re-debits any wallet deposit.
 */
export const DELETE_REASONS = [
  "Created by mistake",
  "Customer cancelled",
  "Duplicate invoice",
  "Wrong customer or items",
  "Test entry",
  "Other",
];

const remainingQty = (line) =>
  Math.max(
    0,
    Number(line.borrow_quantity || 0) -
      Number(line.good_returned_qty || 0) -
      Number(line.defective_returned_qty || 0),
  );

const can = (perms, code) => Boolean(perms && (perms.has("*") || perms.has(code)));

const describeActor = async (models, userId) => {
  const user = await models.User.findByPk(userId, {
    include: [{ model: models.Role, attributes: ["role_name"] }],
  });
  const roles = (user?.Roles || []).map((r) => r.role_name).join(", ");
  const name = user ? `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.username : `User ${userId}`;
  return { name, roles: roles || "Unknown" };
};

const notifyAdmins = async (models, payload) => {
  try {
    const admins = await models.User.findAll({
      include: [
        {
          model: models.Role,
          required: true,
          where: {
            [Op.or]: [
              { hierarchy_level: { [Op.gte]: 100 } },
              { role_name: { [Op.in]: ["Admin", "Administrator", "Owner"] } },
            ],
          },
        },
      ],
    });
    for (const admin of admins) {
      await createNotification(models, { userId: admin.user_id, ...payload });
    }
  } catch {
    /* notifications must never block the delete itself */
  }
};

export const deleteInvoice = async (models, invoiceId, actor, { reason, note } = {}) => {
  if (!DELETE_REASONS.includes(reason)) throw new AppError("Please choose a reason for deleting this invoice.", 400);
  const cleanNote = String(note || "").trim().slice(0, 500);
  if (reason === "Other" && cleanNote.length < 3) throw new AppError("Please describe the reason in the note.", 400);

  const canAny = can(actor.permissions, "invoice:delete:any");
  const { name: actorName, roles } = await describeActor(models, actor.userId);

  const result = await models.sequelize.transaction(async (t) => {
    const invoice = await models.Invoice.unscoped().findByPk(invoiceId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!invoice) throw new AppError("Invoice not found.", 404);
    if (invoice.is_deleted) throw new AppError("This invoice is already deleted.", 409);

    const payments = await models.Payment.findAll({ where: { invoice_id: invoiceId, is_voided: false }, transaction: t });
    const paidTotal = payments.reduce((s, p) => s + Number(p.payment_amount || 0), 0);
    const hasMoney = payments.length > 0 || Number(invoice.advance_paid || 0) > 0;
    if (hasMoney && !canAny) {
      throw new AppError(
        "This invoice has a payment or deposit recorded. Only an administrator can delete it.",
        403,
      );
    }

    // 1. Put equipment that is still out back into stock.
    const lines = await models.InvoiceLine.findAll({ where: { invoice_id: invoiceId }, transaction: t });
    let unitsRestored = 0;
    for (const line of lines) {
      const qty = remainingQty(line);
      if (qty <= 0) continue;
      const eq = await models.Equipment.findByPk(line.equipment_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!eq) continue;
      await eq.update(
        {
          rented_qty: Math.max(0, Number(eq.rented_qty) - qty),
          available_qty: Number(eq.available_qty) + qty,
        },
        { transaction: t },
      );
      unitsRestored += qty;
    }

    // 2. Wallet deposits go back to the customer's wallet.
    const walletTotal = payments
      .filter((p) => p.method === "WalletDeposit")
      .reduce((s, p) => s + Number(p.payment_amount || 0), 0);
    if (walletTotal > 0) {
      const customer = await models.Customer.findByPk(invoice.customer_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (customer) await customer.update({ deposit_balance: Number(customer.deposit_balance) + walletTotal }, { transaction: t });
    }

    // 3. Void (do not erase) the money so it can be reconciled.
    await models.Payment.update(
      { is_voided: true, voided_at: new Date() },
      { where: { invoice_id: invoiceId, is_voided: false }, transaction: t },
    );

    await invoice.update(
      {
        is_deleted: true,
        deleted_at: new Date(),
        deleted_by: actor.userId,
        deleted_by_role: roles,
        delete_reason: reason,
        delete_note: cleanNote || null,
        delete_flagged: !canAny,
        restored_at: null,
        restored_by: null,
      },
      { transaction: t },
    );

    await models.InvoiceTrace.create(
      {
        invoice_id: invoiceId,
        actor_user_id: actor.userId,
        event_category: "ADMIN",
        event_action: "INVOICE_DELETED",
        comments: `Deleted by ${actorName} (${roles}). Reason: ${reason}${cleanNote ? ` — ${cleanNote}` : ""}.`,
        state_payload: { reason, note: cleanNote, paidTotal, voidedPayments: payments.length, unitsRestored, walletRefunded: walletTotal },
      },
      { transaction: t },
    );

    return { invoice_id: invoiceId, flagged: !canAny, paidTotal, voidedPayments: payments.length, unitsRestored, walletRefunded: walletTotal };
  });

  if (result.flagged) {
    await notifyAdmins(models, {
      type: "warning",
      category: "invoice",
      title: `Invoice INV-${invoiceId} deleted by ${actorName}`,
      message: `${actorName} (${roles}) deleted INV-${invoiceId}. Reason: ${reason}${cleanNote ? ` — ${cleanNote}` : ""}.`,
      payload: { invoiceId, reason },
      link: "/reports?category=invoices&report=deleted",
    });
  }
  return result;
};

export const restoreInvoice = async (models, invoiceId, actor) => {
  const { name: actorName, roles } = await describeActor(models, actor.userId);

  return models.sequelize.transaction(async (t) => {
    const invoice = await models.Invoice.unscoped().findByPk(invoiceId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!invoice) throw new AppError("Invoice not found.", 404);
    if (!invoice.is_deleted) throw new AppError("This invoice is not deleted.", 409);

    const lines = await models.InvoiceLine.findAll({ where: { invoice_id: invoiceId }, transaction: t });

    // 1. Make sure the stock it needs is still free.
    const shortages = [];
    const take = [];
    for (const line of lines) {
      const qty = remainingQty(line);
      if (qty <= 0) continue;
      const eq = await models.Equipment.findByPk(line.equipment_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!eq) continue;
      const already = take.filter((x) => x.eq.equipment_id === eq.equipment_id).reduce((s, x) => s + x.qty, 0);
      if (Number(eq.available_qty) < qty + already) {
        shortages.push(`${eq.equipment_name} (needs ${qty}, ${Math.max(0, Number(eq.available_qty) - already)} available)`);
      }
      take.push({ eq, qty });
    }
    if (shortages.length) {
      throw new AppError(`Cannot restore: not enough stock for ${shortages.join(", ")}.`, 409);
    }
    for (const { eq, qty } of take) {
      await eq.reload({ transaction: t });
      await eq.update({ rented_qty: Number(eq.rented_qty) + qty, available_qty: Number(eq.available_qty) - qty }, { transaction: t });
    }

    // 2. Un-void payments; re-debit wallet deposits.
    const voided = await models.Payment.unscoped().findAll({ where: { invoice_id: invoiceId, is_voided: true }, transaction: t });
    const walletTotal = voided.filter((p) => p.method === "WalletDeposit").reduce((s, p) => s + Number(p.payment_amount || 0), 0);
    if (walletTotal > 0) {
      const customer = await models.Customer.findByPk(invoice.customer_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!customer || Number(customer.deposit_balance) < walletTotal) {
        throw new AppError("Cannot restore: the customer's wallet no longer has enough balance to re-apply the deposit.", 409);
      }
      await customer.update({ deposit_balance: Number(customer.deposit_balance) - walletTotal }, { transaction: t });
    }
    await models.Payment.unscoped().update({ is_voided: false, voided_at: null }, { where: { invoice_id: invoiceId, is_voided: true }, transaction: t });

    await invoice.update(
      { is_deleted: false, restored_at: new Date(), restored_by: actor.userId },
      { transaction: t },
    );

    await models.InvoiceTrace.create(
      {
        invoice_id: invoiceId,
        actor_user_id: actor.userId,
        event_category: "ADMIN",
        event_action: "INVOICE_RESTORED",
        comments: `Restored by ${actorName} (${roles}).`,
        state_payload: { paymentsRestored: voided.length, walletReapplied: walletTotal },
      },
      { transaction: t },
    );
    return { invoice_id: invoiceId, paymentsRestored: voided.length };
  });
};

export const listDeletedInvoices = async (models, query = {}) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit) || 25));
  const where = { is_deleted: true };
  if (String(query.flagged) === "true") where.delete_flagged = true;
  if (query.search) {
    const like = `%${String(query.search).trim()}%`;
    const asId = String(query.search).replace(/\D/g, "");
    where[Op.or] = [
      ...(asId ? [{ invoice_id: Number(asId) }] : []),
      { delete_reason: { [Op.like]: like } },
      { delete_note: { [Op.like]: like } },
    ];
  }

  const { count, rows } = await models.Invoice.unscoped().findAndCountAll({
    where,
    include: [{ model: models.Customer, attributes: ["customer_id", "first_name", "last_name", "company_name", "customer_type", "phone_number"] }],
    order: [["deleted_at", "DESC"]],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
    col: "invoice_id",
  });

  const ids = rows.map((r) => r.invoice_id);
  const voidedByInvoice = new Map();
  if (ids.length) {
    const pays = await models.Payment.unscoped().findAll({ where: { invoice_id: { [Op.in]: ids }, is_voided: true } });
    for (const p of pays) voidedByInvoice.set(p.invoice_id, (voidedByInvoice.get(p.invoice_id) || 0) + Number(p.payment_amount || 0));
  }
  const userIds = [...new Set(rows.map((r) => r.deleted_by).filter(Boolean))];
  const users = userIds.length ? await models.User.findAll({ where: { user_id: { [Op.in]: userIds } }, attributes: ["user_id", "first_name", "last_name", "username"] }) : [];
  const nameOf = new Map(users.map((u) => [u.user_id, `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username]));

  const flaggedCount = await models.Invoice.unscoped().count({ where: { is_deleted: true, delete_flagged: true } });
  const totalDeleted = await models.Invoice.unscoped().count({ where: { is_deleted: true } });

  return {
    total: count,
    page,
    summary: { totalDeleted, flaggedCount },
    invoices: rows.map((r) => ({
      invoice_id: r.invoice_id,
      issued_date: r.issued_date,
      total_amount: Number(r.total_amount),
      status: r.status,
      customer: r.Customer || null,
      deleted_at: r.deleted_at,
      deleted_by: r.deleted_by,
      deleted_by_name: nameOf.get(r.deleted_by) || null,
      deleted_by_role: r.deleted_by_role,
      delete_reason: r.delete_reason,
      delete_note: r.delete_note,
      delete_flagged: Boolean(r.delete_flagged),
      voided_amount: voidedByInvoice.get(r.invoice_id) || 0,
    })),
  };
};
