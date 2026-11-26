import { Op } from "sequelize";
import { findCustomerIdsBySearch, isWholeNumber } from "../utils/customerSearch.js";
import AppError from "../utils/AppError.js";
import { getCollectionsSettings } from "./collectionsSettingsService.js";
import { liveTotalOf, owedAmount } from "../utils/invoiceBalance.js";
import { lineAccrual, refreshAccruals } from "./accrualService.js";
import { touchCustomerBrief } from "./customerBriefService.js";
import { notifyEvent } from "./pushEventService.js";
import { isUserAdmin, userHasPermission } from "./userService.js";
import { createSaleBillLinesAndTotals, ensureWalkInCustomer, fromCents, toCents } from "../modules/retail/index.js";
import { recordActivity, resolveUserActivityVisibility } from "./activityService.js";
import { validateReason } from "./activitySettingsService.js";
import { parseJsonField } from "../utils/jsonFields.js";

const formatLkr = (n) => {
  const num = Number(n || 0);
  return Number.isInteger(num)
    ? num.toLocaleString("en-US")
    : num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatCustomerDisplay = (customer) => {
  if (!customer) return "Customer";
  if (customer.customer_type === "Business" && customer.company_name) {
    return customer.company_name;
  }
  return `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "Customer";
};

const lookupStaffName = async (models, userId) => {
  try {
    if (!userId || !models?.User?.findByPk) return "Staff";
    const u = await models.User.findByPk(userId, {
      attributes: ["user_id", "first_name", "last_name", "username"],
    });
    return `${u?.first_name || ""} ${u?.last_name || ""}`.trim() || u?.username || "Staff";
  } catch {
    return "Staff";
  }
};

// Counter clocks drift a little; anything later than this is a typo, not a bill.
const ISSUED_DATE_FUTURE_SLACK_MS = 5 * 60 * 1000;

/**
 * Optional bill date/time for entering a bill after the fact (e.g. a paper
 * bill written while offline). Missing means "now". Never in the future.
 */
export const resolveIssuedDate = (value, now = new Date()) => {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError("The bill date is not a valid date.", 400);
  if (date.getTime() > now.getTime() + ISSUED_DATE_FUTURE_SLACK_MS) {
    throw new AppError("The bill date cannot be in the future.", 400);
  }
  return date;
};

// Rental day maths lives in utils/rentalDays.js (re-exported here for existing callers).
import { chargeableLateDays, dayInShopTz, isOpenEndedLine, lineOutMoment, openEndedExtraDays, periodCharge, wholeDaysBetween } from "../utils/rentalDays.js";
export { wholeDaysBetween, lateDays, isOpenEndedLine, lineOutMoment, elapsedRentalDays, openEndedExtraDays, periodCharge, chargeableLateDays, contractDays } from "../utils/rentalDays.js";

const maybeRecordActivity = async (models, event, opts) => {
  if (models?.ActivityEvent?.create) {
    return recordActivity(models, event, opts);
  }
  return null;
};

const resolvePastOrTodayDate = (value, label, now = new Date()) => {
  if (value === undefined || value === null || value === "") return now;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`The ${label} is not a valid date.`, 400);
  }
  const valueYmd = dayInShopTz(date);
  const todayYmd = dayInShopTz(now);
  if (valueYmd > todayYmd || date.getTime() > now.getTime() + ISSUED_DATE_FUTURE_SLACK_MS) {
    throw new AppError(`The ${label} cannot be in the future.`, 400);
  }
  return date;
};

// --- 1. DISPATCH ENGINE (With Row-Level Locks) ---
export const createDispatchInvoice = async (models, payload, userId) => {
  const {
    customer_id,
    items,
    borrowed_on_behalf_of_customer_id,
    sale_items,
    job_site,
    customer_po,
    settle_now,
    approval_tokens,
    payment,
    walk_in,
    discount,
    discount_amount,
    warehouse_id,
    effectivePermissions,
  } = payload;
  const fees = payload.fees || {};
  const issuedDate = resolveIssuedDate(payload.issued_date);
  const discountAmt = Number(fees?.discount || 0);
  let validatedDiscountReason = null;
  if (discountAmt > 0) {
    validatedDiscountReason = await validateReason(models, "discount", payload.discount_reason);
  }

  const hasRentalItems = Array.isArray(items) && items.length > 0;
  const hasSaleItems = Array.isArray(sale_items) && sale_items.length > 0;

  if (!hasRentalItems && !hasSaleItems) {
    throw new AppError("Invoice must contain at least one item.", 400);
  }
  // Goods only: a sale bill. Machines (with or without goods): the rental path below, which also
  // runs the goods step when sale_items are present (a mixed bill).
  const isMixed = hasRentalItems && hasSaleItems;

  if (hasSaleItems && !hasRentalItems) {
    let resolvedCustomerId = customer_id;
    let soldCount = sale_items.length;
    let changeDue = 0;

    const newSaleInvoice = await models.sequelize.transaction(async (t) => {
      let customer;
      if (walk_in === true || !customer_id) {
        customer = await ensureWalkInCustomer(models, { transaction: t });
      } else {
        customer = await models.Customer.findByPk(customer_id, { transaction: t });
        if (!customer) throw new AppError("Customer not found.", 404);
      }
      resolvedCustomerId = customer.customer_id;

      const bill = await models.Invoice.create(
        {
          customer_id: customer.customer_id,
          issued_by_user_id: userId,
          bill_kind: "sale",
          // Required column on every bill; a sale has no rental days.
          number_of_days_of_the_bill: 0,
          job_site: job_site ? String(job_site).trim().slice(0, 120) : null,
          customer_po: customer_po ? String(customer_po).trim().slice(0, 60) : null,
          sub_total: 0,
          discount_amount: 0,
          total_amount: 0,
          advance_paid: 0,
          status: "PendingPayment",
          ...(issuedDate ? { issued_date: issuedDate } : {}),
        },
        { transaction: t },
      );

      const saleResult = await createSaleBillLinesAndTotals(models, {
        invoiceId: bill.invoice_id,
        customer,
        saleItems: sale_items,
        // The counter sends discount and transport inside `fees`, like rental bills.
        billDiscountAmount: discount ?? discount_amount ?? fees?.discount ?? 0,
        approvalTokens: approval_tokens,
        userId,
        effectivePermissions,
        warehouseId: warehouse_id ?? null,
        occurredAt: issuedDate || new Date(),
        transaction: t,
      });

      soldCount = saleResult.saleLines.length;
      const transportFee = Math.max(0, Number(fees?.transport ?? payload.transport_fee ?? 0) || 0);
      const billTotal = Math.round((saleResult.totalAmount + transportFee) * 100) / 100;
      const tendered = Number(payment?.amount ?? fees?.advance ?? 0);
      if (tendered < 0 || !Number.isFinite(tendered)) {
        throw new AppError("Invalid payment amount.", 400);
      }

      if (customer.is_walk_in && tendered + 0.005 < billTotal) {
        throw new AppError("Walk-in customers must pay in full at checkout.", 422);
      }

      // Cash handed over beyond the total is change, not a payment: record at most the total.
      const paidAmount = Math.min(tendered, billTotal);
      changeDue = Math.max(0, Math.round((tendered - billTotal) * 100) / 100);
      const isFullyPaid = paidAmount + 0.005 >= billTotal;
      const finalStatus = settle_now && isFullyPaid ? "Completed" : "PendingPayment";

      await bill.update(
        {
          sub_total: saleResult.subTotal,
          discount_amount: saleResult.discount,
          transport_fee: transportFee,
          total_amount: billTotal,
          sale_total: saleResult.totalAmount,
          advance_paid: paidAmount,
          status: finalStatus,
        },
        { transaction: t },
      );

      if (paidAmount > 0) {
        const payMethod =
          payment?.method ||
          payload.advance_payment_method ||
          fees?.advance_payment_method ||
          payload.payment_method ||
          "Cash";

        await models.Payment.create(
          {
            invoice_id: bill.invoice_id,
            payment_amount: paidAmount,
            method: payMethod,
            is_advance: false,
            received_by_user_id: userId,
            ...(issuedDate ? { payment_date: issuedDate } : {}),
          },
          { transaction: t },
        );

        if (payMethod === "WalletDeposit") {
          if (Number(customer.deposit_balance) < paidAmount) {
            throw new AppError("Insufficient customer deposit balance in wallet.", 400);
          }
          const newBalance = Math.max(0, Number(customer.deposit_balance) - paidAmount);
          await customer.update({ deposit_balance: newBalance }, { transaction: t });
        }
      }

      await models.InvoiceTrace.create(
        {
          invoice_id: bill.invoice_id,
          actor_user_id: userId,
          event_category: "BILLING",
          event_action: "INVOICE_CREATED",
          comments:
            `Sale bill generated for ${soldCount} items. Total: Rs. ${saleResult.totalAmount}.` +
            (finalStatus === "Completed" ? " Settled at checkout." : "") +
            (issuedDate ? ` Bill date set to ${issuedDate.toISOString()}.` : ""),
          state_payload: {
            bill_kind: "sale",
            sale_items_count: soldCount,
            status: finalStatus,
            ...(issuedDate ? { issued_date: issuedDate.toISOString() } : {}),
          },
        },
        { transaction: t },
      );

      await touchCustomerBrief(models, customer.customer_id, { transaction: t });
      return bill;
    });

    void (async () => {
      try {
        const [customer, staffName] = await Promise.all([
          models.Customer?.findByPk
            ? models.Customer.findByPk(resolvedCustomerId, {
                attributes: ["customer_id", "first_name", "last_name", "company_name", "customer_type"],
              })
            : null,
          lookupStaffName(models, userId),
        ]);
        const customerName = formatCustomerDisplay(customer);
        const total = formatLkr(newSaleInvoice.total_amount);
        await notifyEvent(models, "invoice_created", {
          amount: Number(newSaleInvoice.total_amount || 0),
          actorUserId: userId,
          customerName,
          vars: {
            invoice_no: String(newSaleInvoice.invoice_id),
            amount: Number(newSaleInvoice.total_amount || 0),
            customer: customerName,
            items_count: soldCount,
            staff: staffName,
            date: new Date(),
            time: new Date(),
          },
          title: `New bill #${newSaleInvoice.invoice_id} · LKR ${total}`,
          body: `${customerName} · ${soldCount} items sold · by ${staffName}`,
          titleNoAmount: `New bill #${newSaleInvoice.invoice_id}`,
          bodyNoAmount: `${customerName} · ${soldCount} items sold · by ${staffName}`,
          data: { type: "invoice_created", invoice_id: String(newSaleInvoice.invoice_id) },
          link: "/invoices?mode=manage",
        });
      } catch {
        // Push failures must never affect bill creation
      }
    })();

    // Change due is returned to the till, never stored as a payment.
    if (newSaleInvoice?.setDataValue) newSaleInvoice.setDataValue("change_due", changeDue);
    else if (newSaleInvoice) newSaleInvoice.change_due = changeDue;
    return newSaleInvoice;
  }

  // A bill with machines and goods rents to a named customer only.
  if (isMixed && (walk_in === true || !customer_id)) {
    throw new AppError("Choose a customer to rent equipment", 422);
  }

  let mixedSoldCount = 0;
  const newInvoice = await models.sequelize.transaction(async (t) => {
    let subTotal = 0;

    // Validate basics
    if (!items || items.length === 0)
      throw new AppError("Invoice must contain at least one item.", 400);

    let mixedCustomer = null;
    if (isMixed) {
      mixedCustomer = await models.Customer.findByPk(customer_id, { transaction: t });
      if (!mixedCustomer) throw new AppError("Customer not found.", 404);
      if (mixedCustomer.is_walk_in) throw new AppError("Choose a customer to rent equipment", 422);
    }

    const invoiceLinesData = items.map((item) => {
      const start = new Date(item.borrow_date).getTime();
      const end = new Date(item.expected_return_date).getTime();
      let totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      if (totalDays < 1 || isNaN(totalDays)) totalDays = 1;

      const lineTotal = periodCharge({
        base: item.locked_base_price,
        minDays: item.locked_minimum_days,
        rate: item.locked_extra_daily_rate,
        days: totalDays,
        qty: item.borrow_quantity,
      });
      subTotal += lineTotal;

      return {
        equipment_id: item.equipment_id,
        borrow_date: item.borrow_date,
        expected_return_date: item.expected_return_date,
        locked_base_price: item.locked_base_price,
        locked_minimum_days: item.locked_minimum_days,
        locked_extra_daily_rate: item.locked_extra_daily_rate,
        borrow_quantity: item.borrow_quantity,
        line_total_amount: lineTotal,
        line_status: "Active",
        track_overdue: item.track_overdue !== false,
      };
    });

    const grandTotal = Math.max(
      0,
      subTotal + (fees.transport || 0) - (fees.discount || 0),
    );
    // What the machines come to after the bill discount (a rental-only bill carries all of it).
    const rentalTotalOnly = Math.max(0, Math.round((subTotal - (fees.discount || 0)) * 100) / 100);
    // A mixed bill's one payment can also arrive the way the sale path sends it.
    const advance = fees.advance ?? (isMixed ? payment?.amount : undefined);

    // Guard: if a beneficiary is provided, it must not equal the actor and
    // must be an existing, non-blacklisted customer.
    if (borrowed_on_behalf_of_customer_id) {
      if (Number(borrowed_on_behalf_of_customer_id) === Number(customer_id)) {
        throw new AppError(
          "Beneficiary cannot be the same as the renting customer.",
          400,
        );
      }
      const beneficiary = await models.Customer.findByPk(
        borrowed_on_behalf_of_customer_id,
        { transaction: t },
      );
      if (!beneficiary || beneficiary.customer_delete_status) {
        throw new AppError("Selected beneficiary customer is invalid.", 400);
      }
      if (beneficiary.status === "Blacklisted") {
        throw new AppError(
          "Cannot rent on behalf of a blacklisted customer.",
          400,
        );
      }
    }

    const newInvoice = await models.Invoice.create(
      {
        customer_id,
        borrowed_on_behalf_of_customer_id:
          borrowed_on_behalf_of_customer_id || null,
        issued_by_user_id: userId,
        total_amount: grandTotal,
        advance_paid: advance || 0,
        transport_fee: fees.transport || 0,
        discount_amount: fees.discount || 0,
        discount_reason_key: validatedDiscountReason?.key || null,
        discount_reason_note: validatedDiscountReason?.note || null,
        sub_total: subTotal,
        bill_kind: isMixed ? "mixed" : "rental",
        rental_total: rentalTotalOnly,
        ...(job_site ? { job_site: String(job_site).trim().slice(0, 120) } : {}),
        ...(customer_po ? { customer_po: String(customer_po).trim().slice(0, 60) } : {}),
        number_of_days_of_the_bill: Math.max(
          ...items.map((i) => {
            const days = Math.ceil(
              (new Date(i.expected_return_date).getTime() -
                new Date(i.borrow_date).getTime()) /
                (1000 * 60 * 60 * 24),
            );
            return days < 1 ? 1 : days;
          }),
        ),
        status: "Active",
        id_card_status: 1,
        ...(issuedDate ? { issued_date: issuedDate } : {}),
      },
      { transaction: t },
    );

    const linesWithInvoiceId = invoiceLinesData.map((line) => ({
      ...line,
      invoice_id: newInvoice.invoice_id,
    }));

    await models.InvoiceLine.bulkCreate(linesWithInvoiceId, { transaction: t });

    // --- STRICT INVENTORY DEDUCTION ---
    for (const item of items) {
      if (item.borrow_quantity <= 0)
        throw new AppError("Borrow quantity must be at least 1.", 400);

      // 1. FETCH AND LOCK THE ROW
      const equipment = await models.Equipment.findByPk(item.equipment_id, {
        transaction: t,
        lock: t.LOCK.UPDATE, // Safely locks row from race conditions
      });

      if (!equipment)
        throw new AppError(`Equipment ID ${item.equipment_id} not found.`, 404);

      // Strict validation: Does the math hold up?
      if (equipment.available_qty < item.borrow_quantity) {
        throw new AppError(
          `Not enough stock for ${equipment.equipment_name}. Only ${equipment.available_qty} available.`,
          400,
        );
      }

      // 2. APPLY THE MATH
      await equipment.update(
        {
          available_qty: equipment.available_qty - item.borrow_quantity,
          rented_qty: equipment.rented_qty + item.borrow_quantity,
        },
        { transaction: t },
      );
    }

    // --- GOODS ON THE SAME BILL (mixed): lines, stock and totals, in this same transaction ---
    if (isMixed) {
      const saleResult = await createSaleBillLinesAndTotals(models, {
        invoiceId: newInvoice.invoice_id,
        customer: mixedCustomer,
        saleItems: sale_items,
        billDiscountAmount: fees.discount ?? discount ?? discount_amount ?? 0,
        rentalSubtotal: subTotal,
        approvalTokens: approval_tokens,
        userId,
        effectivePermissions,
        warehouseId: warehouse_id ?? null,
        occurredAt: issuedDate || new Date(),
        transaction: t,
      });
      mixedSoldCount = saleResult.saleLines.length;

      const rentalTotal = fromCents(toCents(subTotal) - toCents(saleResult.rentalDiscountShare));
      const saleTotal = saleResult.saleTotal;
      const transportCents = toCents(fees.transport || 0);
      const billTotalCents = toCents(rentalTotal) + toCents(saleTotal) + transportCents;
      const expectedCents =
        toCents(subTotal) + toCents(saleResult.saleSubTotal) + transportCents - toCents(saleResult.discount);
      if (billTotalCents !== expectedCents) {
        throw new AppError("The bill totals did not add up. Nothing was saved.", 500);
      }

      await newInvoice.update(
        {
          sub_total: saleResult.subTotal,
          discount_amount: saleResult.discount,
          transport_fee: fromCents(transportCents),
          rental_total: rentalTotal,
          sale_total: saleTotal,
          total_amount: fromCents(billTotalCents),
        },
        { transaction: t },
      );
    }

    if (advance > 0) {
      const advMethod =
        (isMixed ? payment?.method : null) ||
        payload.advance_payment_method ||
        fees.advance_payment_method ||
        payload.payment_method ||
        "Cash";

      await models.Payment.create(
        {
          invoice_id: newInvoice.invoice_id,
          payment_amount: advance,
          method: advMethod,
          is_advance: true,
          received_by_user_id: userId,
          ...(issuedDate ? { payment_date: issuedDate } : {}),
        },
        { transaction: t },
      );

      // Only deduct from client wallet if explicitly using deposit balance
      if (advMethod === "WalletDeposit") {
        const customer = await models.Customer.findByPk(customer_id, {
          transaction: t,
        });
        if (!customer || Number(customer.deposit_balance) < Number(advance)) {
          throw new AppError("Insufficient customer deposit balance in wallet.", 400);
        }
        const newBalance = Math.max(0, Number(customer.deposit_balance) - Number(advance));
        await customer.update(
          { deposit_balance: newBalance },
          { transaction: t },
        );
      }
    }

    await models.InvoiceTrace.create(
      {
        invoice_id: newInvoice.invoice_id,
        actor_user_id: userId,
        event_category: "DISPATCH",
        event_action: "INVOICE_CREATED",
        comments:
          (isMixed
            ? `Invoice generated: ${items.length} ${items.length === 1 ? "machine" : "machines"} rented, ${mixedSoldCount} ${mixedSoldCount === 1 ? "item" : "items"} sold. Total: Rs. ${newInvoice.total_amount}.`
            : `Invoice generated for ${items.length} items. Total: Rs. ${grandTotal}.`) +
          (issuedDate ? ` Bill date set to ${issuedDate.toISOString()}.` : ""),
        state_payload: {
          items,
          fees,
          ...(isMixed ? { bill_kind: "mixed", sale_items_count: mixedSoldCount } : {}),
          ...(issuedDate ? { issued_date: issuedDate.toISOString() } : {}),
        },
      },
      { transaction: t },
    );

    // A bill entered for an earlier date may already be running extra days.
    await refreshAccruals(models, { invoiceIds: [newInvoice.invoice_id], transaction: t });
    await touchCustomerBrief(models, customer_id, { transaction: t });

    const now = new Date();
    const todayYmd = dayInShopTz(now);
    const issuedYmd = issuedDate ? dayInShopTz(issuedDate) : todayYmd;
    const billDaysBack = issuedDate ? Math.max(0, wholeDaysBetween(issuedYmd, todayYmd)) : 0;

    await maybeRecordActivity(
      models,
      {
        type: "invoice_created",
        invoice_id: newInvoice.invoice_id,
        customer_id,
        actor_user_id: userId,
        amount: grandTotal,
        occurred_at: now,
        data: { items_count: items.length },
      },
      { transaction: t },
    );

    if (billDaysBack > 0) {
      await maybeRecordActivity(
        models,
        {
          type: "backdated_bill",
          invoice_id: newInvoice.invoice_id,
          customer_id,
          actor_user_id: userId,
          amount: grandTotal,
          occurred_at: now,
          data: {
            days_back: billDaysBack,
            issued_date: issuedYmd,
          },
        },
        { transaction: t },
      );
    }

    if (discountAmt > 0 && validatedDiscountReason) {
      const baseForPct = subTotal + Number(fees.transport || 0);
      const discountPct = baseForPct > 0 ? Math.round((discountAmt / baseForPct) * 10000) / 100 : 0;
      await maybeRecordActivity(
        models,
        {
          type: "discount",
          invoice_id: newInvoice.invoice_id,
          customer_id,
          actor_user_id: userId,
          amount: discountAmt,
          occurred_at: now,
          data: {
            old_amount: 0,
            new_amount: discountAmt,
            discount_pct: discountPct,
            raised_after_printing: false,
            reason_key: validatedDiscountReason.key,
            reason_note: validatedDiscountReason.note,
            reason_label_en: validatedDiscountReason.label_en,
            reason_label_si: validatedDiscountReason.label_si,
          },
        },
        { transaction: t },
      );
    }

    return newInvoice;
  });

  if (!models?.ActivityEvent?.create) {
    // Fallback for legacy unit tests that mock models without ActivityEvent
    void (async () => {
      try {
        const [customer, staffName] = await Promise.all([
          models.Customer?.findByPk
            ? models.Customer.findByPk(customer_id, {
                attributes: ["customer_id", "first_name", "last_name", "company_name", "customer_type"],
              })
            : null,
          lookupStaffName(models, userId),
        ]);
        const customerName = formatCustomerDisplay(customer);
        const total = formatLkr(newInvoice.total_amount);
        const itemCount = items.length + mixedSoldCount;
        const itemsText = isMixed ? `${items.length} rented · ${mixedSoldCount} sold` : `${itemCount} item(s)`;
        await notifyEvent(models, "invoice_created", {
          amount: Number(newInvoice.total_amount || 0),
          actorUserId: userId,
          customerName,
          vars: {
            invoice_no: String(newInvoice.invoice_id),
            amount: Number(newInvoice.total_amount || 0),
            customer: customerName,
            items_count: itemCount,
            staff: staffName,
            date: new Date(),
            time: new Date(),
          },
          title: `New bill #${newInvoice.invoice_id} · LKR ${total}`,
          body: `${customerName} · ${itemsText} · by ${staffName}`,
          titleNoAmount: `New bill #${newInvoice.invoice_id}`,
          bodyNoAmount: `${customerName} · ${itemsText} · by ${staffName}`,
          data: { type: "invoice_created", invoice_id: String(newInvoice.invoice_id) },
          link: "/invoices?mode=manage",
        });
      } catch {
        // Push failures must never affect bill creation
      }
    })();
  }

  return newInvoice;
};

// --- 2. GLOBAL SEARCH ENGINE ---
export const getAllInvoices = async (models, queryParams) => {
  const page = parseInt(queryParams.page) || 1;
  const limit = parseInt(queryParams.limit) || 20;
  const offset = (page - 1) * limit;

  const whereClause = {};

  // Search finds an invoice number or a customer matching name, ID, NIC, or phone.
  if (queryParams.search) {
    const searchTerm = String(queryParams.search);
    const matches = [
      { customer_id: { [Op.in]: await findCustomerIdsBySearch(models, searchTerm) } },
    ];
    if (isWholeNumber(searchTerm)) matches.push({ invoice_id: Number(searchTerm.trim()) });
    whereClause[Op.and] = [{ [Op.or]: matches }];
  }

  if (queryParams.customer_id) {
    whereClause[Op.or] = [
      { customer_id: queryParams.customer_id },
      { borrowed_on_behalf_of_customer_id: queryParams.customer_id },
    ];
  }

  // "Active" = still open: machines out, or all back but not yet completed (awaiting refund/discount/close)
  const OPEN_STATUSES = ["Active", "PendingPayment"];
  if (queryParams.status === "Active") whereClause.status = { [Op.in]: OPEN_STATUSES };
  else if (queryParams.status) whereClause.status = queryParams.status;
  if (queryParams.bill_kind) whereClause.bill_kind = queryParams.bill_kind;

  const [countsResult, findResult] = await Promise.all([
    Promise.all([
      models.Invoice.count(),
      models.Invoice.count({ where: { status: { [Op.in]: OPEN_STATUSES } } }),
      models.Invoice.count({ where: { status: "Completed" } }),
    ]),
    models.Invoice.findAndCountAll({
      distinct: true,
      col: "invoice_id",
      where: whereClause,
      include: [
        {
          model: models.Customer,
          attributes: [
            "customer_id",
            "first_name",
            "last_name",
            "company_name",
            "customer_type",
            "phone_number",
            "is_id_retained_currently",
          ],
        },
        {
          model: models.Customer,
          as: "OnBehalfOfCustomer",
          attributes: [
            "customer_id",
            "first_name",
            "last_name",
            "company_name",
            "customer_type",
          ],
          required: false,
        },
        // Lists are fetched on their own (separate: true) for just this page of bills, instead of
        // one join that multiplied lines x sale lines x payments x history for every bill.
        {
          model: models.InvoiceLine,
          separate: true,
          order: [["line_id", "ASC"]],
          include: [
            {
              model: models.Equipment,
              attributes: ["equipment_name", "equipment_name_si", "serial_number", "image_url", "is_bulk_item"],
            },
          ],
        },
        {
          model: models.InvoiceSaleLine,
          as: "SaleLines",
          required: false,
          separate: true,
          order: [["sale_line_id", "ASC"]],
        },
        {
          model: models.Payment,
          // invoice_id is needed so separate rows can be matched back to their bill.
          attributes: ["payment_id", "invoice_id", "payment_amount", "payment_date", "method"],
          separate: true,
          order: [["payment_id", "ASC"]],
        },
        { model: models.InvoiceTrace, separate: true, order: [["createdAt", "ASC"], ["trace_id", "ASC"]] },
      ],
      limit,
      offset,
      order: [["issued_date", "DESC"], ["invoice_id", "DESC"]],
    }),
  ]);

  const [allCount, activeCount, completedCount] = countsResult;
  const { count, rows } = findResult;

  // Goods on each bill (voided lines of a deleted bill don't count).
  for (const row of rows) {
    const sold = (row.SaleLines || []).filter((l) => l.status !== "voided").length;
    if (typeof row.setDataValue === "function") row.setDataValue("items_sold_count", sold);
    else row.items_sold_count = sold;
  }

  return {
    totalItems: count,
    invoices: rows,
    counts: {
      all: allCount,
      active: activeCount,
      completed: completedCount,
    },
  };
};

// --- 3. GET SINGLE INVOICE DETAILS ---
export const getInvoiceById = async (models, invoiceId) => {
  // One invoice is cheap to bring up to the minute, so the detail view is always exact.
  await refreshAccruals(models, { invoiceIds: [invoiceId] });
  const invoice = await models.Invoice.findByPk(invoiceId, {
    include: [
      { model: models.Customer },
      {
        model: models.Customer,
        as: "OnBehalfOfCustomer",
        attributes: [
          "customer_id",
          "first_name",
          "last_name",
          "company_name",
          "customer_type",
          "phone_number",
        ],
        required: false,
      },
      // Each list is fetched on its own (separate: true). Joined together, lines x sale lines x
      // payments x history multiplied into hundreds of rows per bill and made opening a bill slow.
      {
        model: models.InvoiceLine,
        separate: true,
        order: [["line_id", "ASC"]],
        include: [
          {
            model: models.Equipment,
            attributes: ["equipment_name", "equipment_name_si", "serial_number", "image_url", "is_bulk_item"],
          },
        ],
      },
      {
        model: models.InvoiceSaleLine,
        as: "SaleLines",
        required: false,
        separate: true,
        order: [["sale_line_id", "ASC"]],
      },
      { model: models.Payment, separate: true, order: [["payment_id", "ASC"]] },
      { model: models.InvoiceTrace, separate: true, order: [["createdAt", "DESC"], ["trace_id", "DESC"]] },
      // who issued the bill: the cashier named on receipts (read by Invoice.toJSON as `issued_by`)
      ...(models.User ? [{ model: models.User, attributes: ["user_id", "first_name", "last_name", "username"], required: false }] : []),
    ],
  });

  if (!invoice) throw new AppError("Invoice not found", 404);
  const settings = await getCollectionsSettings(models).catch(() => null);
  const rec = settings?.call_recording;
  if (rec?.termsLineEnabled && typeof invoice.setDataValue === "function") {
    invoice.setDataValue("call_recording_terms", {
      enabled: true,
      en: rec.termsLine_en,
      si: rec.termsLine_si,
    });
  }
  return invoice;
};

// --- 4. CONTINUOUS RETURN ENGINE (Partial Return Logic Upgraded) ---
/**
 * Per-bill return execution (refactored from processReturn for reuse by Customer Settlement).
 * Supports `transaction` and `dryRun`: when `dryRun` is true, performs zero writes and computes
 * post-return accruals, totals, and line states in memory.
 */
export const executeReturnOnInvoice = async (
  models,
  payload,
  userId,
  {
    transaction: t = null,
    dryRun = false,
    now = new Date(),
    actualReturnDate: passedReturnDate = null,
    actualReturnYmd: passedReturnYmd = null,
    todayYmd: passedTodayYmd = null,
    returnDaysBack: passedDaysBack = null,
    validatedDateReason = null,
    settlementId = null,
    skipPayment = false,
    skipActivities = false,
    preloadedInvoice = null,
    preloadedTotalPaid = null,
  } = {},
) => {
  const {
    invoice_id,
    lines_returned = [],
    final_payment_amount,
    release_id_card,
    payment_method,
    customer_rating,
  } = payload;

  const actualReturnDate =
    passedReturnDate || resolvePastOrTodayDate(payload.actual_return_date, "return date", now);
  const actualReturnYmd = passedReturnYmd || dayInShopTz(actualReturnDate);
  const todayYmd = passedTodayYmd || dayInShopTz(now);
  const returnDaysBack =
    passedDaysBack !== null && passedDaysBack !== undefined
      ? passedDaysBack
      : Math.max(0, wholeDaysBetween(actualReturnYmd, todayYmd));

  const invoice =
    preloadedInvoice ||
    (await models.Invoice.findByPk(invoice_id, {
      ...(t ? { transaction: t } : {}),
    }));
  if (!invoice || invoice.status === "Completed") {
    throw new AppError("Invoice not found or already completed.", 400);
  }

  let totalLateFees = 0;
  let nowLateFees = 0;
  let totalReturnedQty = 0;
  let totalDamagedQty = 0;
  let maxLateDays = 0;
  // Days out on lines with no return date are the rental itself, so they also go into the
  // subtotal. Only late days past a set due date are a late fee (outside the subtotal).
  let rentalDaysAdded = 0;

  const lineResults = [];
  const updatedLineOverrides = new Map();

  for (const returnData of lines_returned) {
    // 1. Lock the specific invoice line (when not dryRun)
    const preloadedLine = preloadedInvoice?.InvoiceLines?.find(
      (l) => Number(l.line_id) === Number(returnData.line_id),
    );
    const line =
      preloadedLine ||
      (await models.InvoiceLine.findByPk(returnData.line_id, {
        ...(t ? { transaction: t } : {}),
        ...(t && !dryRun ? { lock: t.LOCK.UPDATE } : {}),
      }));
    if (!line) {
      throw new AppError(`Line item ${returnData.line_id} not found.`, 404);
    }

    const goodQty = parseInt(returnData.good_qty) || 0;
    const badQty = parseInt(returnData.defective_qty) || 0;
    const totalReturnedNow = goodQty + badQty;

    // Skip processing if they aren't returning anything for this specific line today
    if (totalReturnedNow <= 0) continue;

    totalReturnedQty += totalReturnedNow;
    totalDamagedQty += badQty;

    // 2. Validate Partial Returns (Do not let them return more than they owe)
    const alreadyReturned =
      (line.good_returned_qty || 0) + (line.defective_returned_qty || 0);
    const remainingToReturn = line.borrow_quantity - alreadyReturned;

    if (totalReturnedNow > remainingToReturn) {
      throw new AppError(
        `Invalid Return: Line ${line.line_id} only has ${remainingToReturn} items left out on rent. You tried to return ${totalReturnedNow}.`,
        400,
      );
    }

    // 3. Late Fee Math — skipped entirely when overdue tracking is off for
    //    this line (either opted out at dispatch or waived at handover).
    const overdueEnabled =
      line.track_overdue !== false && returnData.track_overdue !== false;

    const lineReturnYmd = returnData.actual_return_date || actualReturnYmd;
    const lineReturnAt = returnData.actual_return_at || actualReturnDate;

    // A line dispatched with no return date was priced for 1 day. Its real rental length is only
    // known now, so every day out beyond what the price already covers is billed here.
    const openEnded = isOpenEndedLine(line);
    const extraDays = openEnded
      ? openEndedExtraDays(line, lineOutMoment(line, invoice.issued_date), lineReturnAt)
      : overdueEnabled
        ? // Days past the due date that are still inside the paid period are not charged.
          chargeableLateDays(line, lineReturnYmd)
        : 0;

    const nowExtraDays = openEnded
      ? openEndedExtraDays(line, lineOutMoment(line, invoice.issued_date), now)
      : overdueEnabled
        ? chargeableLateDays(line, todayYmd)
        : 0;

    if (extraDays > maxLateDays) maxLateDays = extraDays;

    let lineLateFee = 0;
    if (extraDays > 0) {
      lineLateFee =
        extraDays * line.locked_extra_daily_rate * totalReturnedNow;
      totalLateFees += lineLateFee;
      if (openEnded) rentalDaysAdded += lineLateFee;
    }
    let nowLineLateFee = 0;
    if (nowExtraDays > 0) {
      nowLineLateFee = nowExtraDays * line.locked_extra_daily_rate * totalReturnedNow;
      nowLateFees += nowLineLateFee;
    }

    // 4. Update the Line Item Stats cumulatively
    const newGoodTotal = (line.good_returned_qty || 0) + goodQty;
    const newBadTotal = (line.defective_returned_qty || 0) + badQty;
    const newGrandTotalReturned = newGoodTotal + newBadTotal;

    // If they returned everything, close the line. If not, keep it "Active"
    const newLineStatus =
      newGrandTotalReturned >= line.borrow_quantity ? "Returned" : "Active";

    // If the caller explicitly waived overdue for this line, persist it so
    // future partial-return settlements on the same line are also fee-free.
    const updatedTrackOverdue =
      returnData.track_overdue === false ? false : line.track_overdue;

    const newLineTotalAmount = Number(line.line_total_amount) + lineLateFee;

    updatedLineOverrides.set(Number(line.line_id), {
      good_returned_qty: newGoodTotal,
      defective_returned_qty: newBadTotal,
      line_status: newLineStatus,
      track_overdue: updatedTrackOverdue,
      actual_return_date: lineReturnYmd,
      line_total_amount: newLineTotalAmount,
    });

    lineResults.push({
      line_id: Number(line.line_id),
      equipment_id: Number(line.equipment_id),
      good_qty: goodQty,
      defective_qty: badQty,
      returned_qty: totalReturnedNow,
      extra_days: extraDays,
      line_late_fee: Math.round(lineLateFee * 100) / 100,
      now_line_late_fee: Math.round(nowLineLateFee * 100) / 100,
      line_status: newLineStatus,
      remaining_before: remainingToReturn,
      remaining_after: remainingToReturn - totalReturnedNow,
    });

    if (!dryRun) {
      await line.update(
        {
          actual_return_date: lineReturnYmd,
          good_returned_qty: newGoodTotal,
          defective_returned_qty: newBadTotal,
          line_total_amount: newLineTotalAmount,
          line_status: newLineStatus,
          track_overdue: updatedTrackOverdue,
          ...(settlementId ? { settlement_id: settlementId } : {}),
        },
        { transaction: t },
      );

      // --- INVENTORY RETURN & ROUTING ---
      const equipment = await models.Equipment.findByPk(line.equipment_id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      await equipment.update(
        {
          rented_qty: equipment.rented_qty - totalReturnedNow,
          available_qty: equipment.available_qty + goodQty,
          defective_qty: equipment.defective_qty + badQty,
        },
        { transaction: t },
      );

      // --- DEFECT WORKFLOW LOGGING ---
      if (badQty > 0) {
        await models.DefectLog.create(
          {
            equipment_id: equipment.equipment_id,
            reported_on_invoice_id: invoice_id,
            defective_quantity: badQty,
            pending_quantity: badQty,
            repaired_quantity: 0,
            repair_status: "Pending Assignment",
            defect_description: `Automatically logged during return for Invoice INV-${invoice_id}. Needs inspection.`,
            reported_date: new Date(),
          },
          { transaction: t },
        );
      }
    }
  }

  // 5. Settle Finance and Master Invoice Status
  const newGrandTotal = Number(invoice.total_amount) + totalLateFees;
  const newSubTotal = Number(invoice.sub_total || 0) + rentalDaysAdded;

  if (!dryRun && !skipPayment && final_payment_amount > 0) {
    await models.Payment.create(
      {
        invoice_id,
        payment_amount: final_payment_amount,
        method: payment_method || "Cash",
        received_by_user_id: userId,
        ...(settlementId ? { settlement_id: settlementId } : {}),
      },
      { transaction: t },
    );
  }

  let activeLinesCount = 0;
  let afterAccruedCharges = 0;
  let afterAccruedRental = 0;

  if (!dryRun) {
    // What was returned is now billed; whatever is still out keeps running from here.
    await refreshAccruals(models, { invoiceIds: [invoice_id], now, transaction: t });

    // If ANY line item is still "Active" (partially returned), the Invoice stays "Active"
    activeLinesCount = await models.InvoiceLine.count({
      where: { invoice_id, line_status: "Active" },
      transaction: t,
    });
    const refreshedInv = await models.Invoice.findByPk(invoice_id, {
      attributes: ["accrued_charges", "accrued_rental"],
      transaction: t,
    });
    afterAccruedCharges = Number(refreshedInv?.accrued_charges || 0);
    afterAccruedRental = Number(refreshedInv?.accrued_rental || 0);
  } else {
    const allLines =
      preloadedInvoice?.InvoiceLines ||
      (await models.InvoiceLine.findAll({
        where: { invoice_id },
        ...(t ? { transaction: t } : {}),
      }));
    for (const l of allLines) {
      const ov = updatedLineOverrides.get(Number(l.line_id));
      const simLine = ov
        ? {
            ...(typeof l.get === "function" ? l.get({ plain: true }) : l),
            ...ov,
          }
        : l;
      if (simLine.line_status === "Active") activeLinesCount++;
      const acc = lineAccrual(simLine, invoice.issued_date, now);
      afterAccruedCharges += acc.accrued_charge;
      if (acc.rental) afterAccruedRental += acc.accrued_charge;
    }
    afterAccruedCharges = Math.round(afterAccruedCharges * 100) / 100;
    afterAccruedRental = Math.round(afterAccruedRental * 100) / 100;
  }

  const totalPaid =
    preloadedTotalPaid !== null && preloadedTotalPaid !== undefined
      ? Number(preloadedTotalPaid)
      : (await models.Payment.sum("payment_amount", {
          where: { invoice_id, is_voided: false },
          ...(t ? { transaction: t } : {}),
        })) || 0;

  const isPaidOff = Number(totalPaid) >= Number(newGrandTotal);
  const finalStatus = activeLinesCount === 0 ? "PendingPayment" : "Active";
  const shouldReleaseId = !dryRun && !skipPayment && release_id_card && isPaidOff;

  if (!dryRun) {
    await invoice.update(
      {
        total_amount: newGrandTotal,
        sub_total: newSubTotal,
        // Rental days billed on return are part of the rental, so rental_total moves with sub_total.
        rental_total: Math.round((Number(invoice.rental_total || 0) + rentalDaysAdded) * 100) / 100,
        status: finalStatus,
        id_card_status: shouldReleaseId ? 0 : invoice.id_card_status,
      },
      { transaction: t },
    );

    if (shouldReleaseId) {
      await models.Customer.update(
        { is_id_retained_currently: false },
        { where: { customer_id: invoice.customer_id }, transaction: t },
      );
    }

    if (customer_rating && invoice.customer_id) {
      await models.Customer.update(
        { rating: Number(customer_rating) },
        { where: { customer_id: invoice.customer_id }, transaction: t },
      );
    }

    await models.InvoiceTrace.create(
      {
        invoice_id,
        actor_user_id: userId,
        event_category: "SETTLEMENT",
        event_action: "RETURN_PROCESSED",
        comments: `Handover processed. Late fees: Rs.${totalLateFees}. Status: ${finalStatus}.`,
        state_payload: {
          lines_returned,
          ...(settlementId ? { settlement_id: settlementId } : {}),
        },
      },
      { transaction: t },
    );

    await touchCustomerBrief(models, invoice.customer_id, { transaction: t });
  }

  const lateFeeDifference = Math.round((nowLateFees - totalLateFees) * 100) / 100;
  const returnAmount = Number(final_payment_amount || 0) + Number(totalLateFees || 0);

  if (!dryRun && !skipActivities) {
    await maybeRecordActivity(
      models,
      {
        type: "return",
        invoice_id,
        customer_id: invoice.customer_id,
        actor_user_id: userId,
        amount: returnAmount,
        occurred_at: now,
        data: {
          returned_qty: totalReturnedQty,
          damaged_qty: totalDamagedQty,
          has_damaged: totalDamagedQty > 0,
          late_days: maxLateDays,
          late_fees: totalLateFees,
          final_status: finalStatus,
        },
      },
      { transaction: t },
    );

    if (returnDaysBack > 0) {
      await maybeRecordActivity(
        models,
        {
          type: "backdated_return",
          invoice_id,
          customer_id: invoice.customer_id,
          actor_user_id: userId,
          amount: totalLateFees,
          occurred_at: now,
          data: {
            days_back: returnDaysBack,
            actual_return_date: actualReturnYmd,
            late_fee_difference: lateFeeDifference,
            now_late_fees: nowLateFees,
            actual_late_fees: totalLateFees,
            reason_key: validatedDateReason?.key || null,
            reason_note: validatedDateReason?.note || null,
            reason_label_en: validatedDateReason?.label_en || null,
            reason_label_si: validatedDateReason?.label_si || null,
          },
        },
        { transaction: t },
      );
    }
  }

  return {
    invoice_id: Number(invoice_id),
    customer_id: invoice.customer_id,
    totalLateFees: Math.round(Number(totalLateFees || 0) * 100) / 100,
    nowLateFees: Math.round(Number(nowLateFees || 0) * 100) / 100,
    rentalDaysAdded: Math.round(Number(rentalDaysAdded || 0) * 100) / 100,
    newGrandTotal: Math.round(newGrandTotal * 100) / 100,
    newSubTotal: Math.round(newSubTotal * 100) / 100,
    afterAccruedCharges,
    afterAccruedRental,
    activeLinesCount,
    totalReturnedQty,
    totalDamagedQty,
    maxLateDays,
    finalPayment: Number(final_payment_amount || 0),
    finalStatus,
    isPaidOff,
    lateFeeDifference,
    lineResults,
    updatedLineOverrides,
  };
};

export const processReturn = async (models, payload, userId) => {
  const now = new Date();
  const actualReturnDate = resolvePastOrTodayDate(payload.actual_return_date, "return date", now);
  const actualReturnYmd = dayInShopTz(actualReturnDate);
  const todayYmd = dayInShopTz(now);
  const returnDaysBack = Math.max(0, wholeDaysBetween(actualReturnYmd, todayYmd));

  let validatedDateReason = null;
  if (returnDaysBack > 0) {
    validatedDateReason = await validateReason(models, "backdate", payload.date_reason);
  }

  const returnMeta = await models.sequelize.transaction(async (t) => {
    return executeReturnOnInvoice(models, payload, userId, {
      transaction: t,
      dryRun: false,
      now,
      actualReturnDate,
      actualReturnYmd,
      todayYmd,
      returnDaysBack,
      validatedDateReason,
    });
  });

  if (!models?.ActivityEvent?.create) {
    void (async () => {
      try {
        const [customer, staffName] = await Promise.all([
          models.Customer?.findByPk && returnMeta?.customer_id
            ? models.Customer.findByPk(returnMeta.customer_id, {
                attributes: ["customer_id", "first_name", "last_name", "company_name", "customer_type"],
              })
            : null,
          lookupStaffName(models, userId),
        ]);
        const customerName = formatCustomerDisplay(customer);
        const amount = Number(returnMeta?.finalPayment || 0) + Number(returnMeta?.totalLateFees || 0);
        await notifyEvent(models, "return_processed", {
          amount,
          actorUserId: userId,
          customerName,
          vars: {
            invoice_no: String(payload.invoice_id),
            amount,
            customer: customerName,
            items: returnMeta?.finalStatus || "",
            staff: staffName,
          },
          title: amount > 0
            ? `Return on #${payload.invoice_id} · LKR ${formatLkr(amount)}`
            : `Return processed on #${payload.invoice_id}`,
          body: `${customerName} · ${returnMeta?.finalStatus || "Updated"} · by ${staffName}`,
          titleNoAmount: `Return processed on #${payload.invoice_id}`,
          bodyNoAmount: `${customerName} · ${returnMeta?.finalStatus || "Updated"} · by ${staffName}`,
          data: { type: "return_processed", invoice_id: String(payload.invoice_id) },
          link: "/invoices?mode=manage",
        });
      } catch {
        // Push failures must never affect return processing
      }
    })();
  }

  return true;
};

/**
 * Compute late fees for a proposed return date vs today without mutating anything.
 */
export const previewReturn = async (models, invoiceId, payload = {}) => {
  const now = new Date();
  const actualReturnDate = resolvePastOrTodayDate(payload.actual_return_date, "return date", now);
  const actualReturnYmd = dayInShopTz(actualReturnDate);
  const todayYmd = dayInShopTz(now);
  const daysBack = Math.max(0, wholeDaysBetween(actualReturnYmd, todayYmd));

  const invoice = await models.Invoice.findByPk(invoiceId, {
    include: models.InvoiceLine ? [{ model: models.InvoiceLine, required: false }] : [],
  });
  if (!invoice) throw new AppError("Invoice not found.", 404);

  const linesMap = new Map((invoice.InvoiceLines || []).map((l) => [Number(l.line_id), l]));
  const linesReturned = Array.isArray(payload.lines_returned) ? payload.lines_returned : [];

  let actualLateFees = 0;
  let nowLateFees = 0;

  for (const r of linesReturned) {
    const line = linesMap.get(Number(r.line_id));
    if (!line) continue;
    const totalReturnedNow = (parseInt(r.good_qty, 10) || 0) + (parseInt(r.defective_qty, 10) || 0);
    if (totalReturnedNow <= 0) continue;

    const overdueEnabled = line.track_overdue !== false && r.track_overdue !== false;
    const openEnded = isOpenEndedLine(line);
    const extraDays = openEnded
      ? openEndedExtraDays(line, lineOutMoment(line, invoice.issued_date), r.actual_return_at || actualReturnDate)
      : overdueEnabled
        ? chargeableLateDays(line, r.actual_return_date || actualReturnYmd)
        : 0;
    const nowExtraDays = openEnded
      ? openEndedExtraDays(line, lineOutMoment(line, invoice.issued_date), now)
      : overdueEnabled
        ? chargeableLateDays(line, todayYmd)
        : 0;

    if (extraDays > 0) actualLateFees += extraDays * Number(line.locked_extra_daily_rate) * totalReturnedNow;
    if (nowExtraDays > 0) nowLateFees += nowExtraDays * Number(line.locked_extra_daily_rate) * totalReturnedNow;
  }

  const late_fee_difference = Math.round((nowLateFees - actualLateFees) * 100) / 100;
  return {
    actual_return_date: actualReturnYmd,
    days_back: daysBack,
    actual_late_fees: Math.round(actualLateFees * 100) / 100,
    now_late_fees: Math.round(nowLateFees * 100) / 100,
    late_fee_difference,
  };
};

const assertNotCompleted = (invoice, action) => {
  if (invoice.status === "Completed") {
    throw new AppError(`This invoice is completed — reopen it to ${action} it.`, 409);
  }
};

const BALANCE_TOLERANCE = 0.005;

// --- 4b. COMPLETE / REOPEN ---
// Closing is an explicit staff decision, allowed only when every machine is back and the money is
// square: nothing owed by the customer and nothing (advance, overpayment) owed back to them.
export const completeInvoice = async (models, invoiceId, { release_id_card } = {}, userId) =>
  models.sequelize.transaction(async (t) => {
    const invoice = await models.Invoice.findByPk(invoiceId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!invoice) throw new AppError("Invoice not found", 404);
    if (invoice.status === "Completed") throw new AppError("This invoice is already completed.", 409);

    const lines = await models.InvoiceLine.findAll({ where: { invoice_id: invoiceId }, transaction: t });
    const outstanding = lines.reduce(
      (s, l) => s + Math.max(0, Number(l.borrow_quantity || 0) - Number(l.good_returned_qty || 0) - Number(l.defective_returned_qty || 0)),
      0,
    );
    if (outstanding > 0) throw new AppError(`${outstanding} item(s) are still out — return them before completing the invoice.`, 409);

    const paid = Number(await models.Payment.sum("payment_amount", { where: { invoice_id: invoiceId, is_voided: false }, transaction: t })) || 0;
    const balance = Number(invoice.total_amount) - paid;
    if (balance > BALANCE_TOLERANCE) {
      throw new AppError(`The customer still owes Rs.${balance.toLocaleString()} — collect it or give a discount before completing.`, 409);
    }
    if (balance < -BALANCE_TOLERANCE) {
      throw new AppError(`Rs.${(-balance).toLocaleString()} is still due back to the customer — record the refund before completing.`, 409);
    }

    await invoice.update({ status: "Completed", id_card_status: release_id_card ? 0 : invoice.id_card_status }, { transaction: t });
    if (release_id_card) {
      await models.Customer.update({ is_id_retained_currently: false }, { where: { customer_id: invoice.customer_id }, transaction: t });
    }
    await models.InvoiceTrace.create(
      { invoice_id: invoiceId, actor_user_id: userId, event_category: "SETTLEMENT", event_action: "INVOICE_COMPLETED", comments: "Invoice completed and closed by staff." },
      { transaction: t },
    );
    await touchCustomerBrief(models, invoice.customer_id, { transaction: t });
    return invoice;
  });

// For invoices closed too early (e.g. by the old automatic completion) so a refund or discount can
// still be recorded.
export const reopenInvoice = async (models, invoiceId, userId) =>
  models.sequelize.transaction(async (t) => {
    const invoice = await models.Invoice.findByPk(invoiceId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!invoice) throw new AppError("Invoice not found", 404);
    if (invoice.status !== "Completed") throw new AppError("Only a completed invoice can be reopened.", 409);
    const active = await models.InvoiceLine.count({ where: { invoice_id: invoiceId, line_status: "Active" }, transaction: t });
    const status = active > 0 ? "Active" : "PendingPayment";
    await invoice.update({ status }, { transaction: t });
    await models.InvoiceTrace.create(
      { invoice_id: invoiceId, actor_user_id: userId, event_category: "SETTLEMENT", event_action: "INVOICE_REOPENED", comments: "Invoice reopened for further settlement." },
      { transaction: t },
    );
    await touchCustomerBrief(models, invoice.customer_id, { transaction: t });
    await maybeRecordActivity(
      models,
      {
        type: "invoice_reopened",
        invoice_id: invoiceId,
        customer_id: invoice.customer_id,
        actor_user_id: userId,
        amount: Number(invoice.total_amount || 0),
        data: { next_status: status },
      },
      { transaction: t },
    );
    return invoice;
  });

// --- 5. CONTINUOUS PAYMENTS & REFUNDS ---
export const addContinuousPayment = async (
  models,
  invoiceId,
  payload,
  userId,
) => {
  const { amount, method, is_refund } = payload;
  const numeric = Math.abs(Number(amount));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new AppError("Payment amount must be greater than 0.", 400);
  }
  const actualAmount = is_refund ? -numeric : numeric;

  const now = new Date();
  const paymentDate = resolvePastOrTodayDate(payload.payment_date, "payment date", now);
  const paymentYmd = dayInShopTz(paymentDate);
  const todayYmd = dayInShopTz(now);
  const paymentDaysBack = Math.max(0, wholeDaysBetween(paymentYmd, todayYmd));

  let validatedDateReason = null;
  if (!is_refund && paymentDaysBack > 0) {
    validatedDateReason = await validateReason(models, "backdate", payload.date_reason);
  }

  let refundReason = null;
  if (is_refund && payload.reason) {
    refundReason = await validateReason(models, "refund", payload.reason);
  }

  const { payment, customerId } = await models.sequelize.transaction(async (t) => {
    const invoice = await models.Invoice.findByPk(invoiceId, {
      transaction: t,
    });
    if (!invoice) throw new AppError("Invoice not found", 404);
    assertNotCompleted(invoice, "record payments or refunds on");

    // A refund can never exceed what has actually been paid (net of earlier refunds).
    if (is_refund) {
      const netPaid =
        Number(
          await models.Payment.sum("payment_amount", {
            where: { invoice_id: invoiceId, is_voided: false },
            transaction: t,
          }),
        ) || 0;
      if (numeric > netPaid + 0.005) {
        throw new AppError(
          `Cannot refund Rs.${numeric.toLocaleString()} — only Rs.${Math.max(0, netPaid).toLocaleString()} has been paid on this invoice.`,
          400,
        );
      }
    }

    const payment = await models.Payment.create(
      {
        invoice_id: invoiceId,
        payment_amount: actualAmount,
        payment_date: paymentDate,
        entered_at: now,
        method: method || "Cash",
        received_by_user_id: userId,
      },
      { transaction: t },
    );

    await models.InvoiceTrace.create(
      {
        invoice_id: invoiceId,
        actor_user_id: userId,
        event_category: "FINANCE",
        event_action: is_refund ? "REFUND_ISSUED" : "PAYMENT_RECEIVED",
        comments: `${is_refund ? "Refund" : "Payment"} of Rs.${Math.abs(actualAmount)} via ${method}.`,
      },
      { transaction: t },
    );

    await touchCustomerBrief(models, invoice.customer_id, { transaction: t });

    if (is_refund) {
      await maybeRecordActivity(
        models,
        {
          type: "refund",
          invoice_id: invoiceId,
          customer_id: invoice.customer_id,
          actor_user_id: userId,
          amount: numeric,
          occurred_at: now,
          data: {
            method: method || "Cash",
            ...(refundReason
              ? {
                  reason_key: refundReason.key,
                  reason_note: refundReason.note,
                  reason_label_en: refundReason.label_en,
                  reason_label_si: refundReason.label_si,
                }
              : {}),
          },
        },
        { transaction: t },
      );
    } else if (paymentDaysBack > 0) {
      await maybeRecordActivity(
        models,
        {
          type: "backdated_payment",
          invoice_id: invoiceId,
          customer_id: invoice.customer_id,
          actor_user_id: userId,
          amount: numeric,
          occurred_at: now,
          data: {
            days_back: paymentDaysBack,
            payment_date: paymentYmd,
            method: method || "Cash",
            reason_key: validatedDateReason?.key || null,
            reason_note: validatedDateReason?.note || null,
            reason_label_en: validatedDateReason?.label_en || null,
            reason_label_si: validatedDateReason?.label_si || null,
          },
        },
        { transaction: t },
      );
    } else {
      await maybeRecordActivity(
        models,
        {
          type: "payment",
          invoice_id: invoiceId,
          customer_id: invoice.customer_id,
          actor_user_id: userId,
          amount: numeric,
          occurred_at: now,
          data: { method: method || "Cash" },
        },
        { transaction: t },
      );
    }

    return { payment, customerId: invoice.customer_id };
  });

  if (!models?.ActivityEvent?.create) {
    void (async () => {
      try {
        const [customer, staffName] = await Promise.all([
          models.Customer?.findByPk && customerId
            ? models.Customer.findByPk(customerId, {
                attributes: ["customer_id", "first_name", "last_name", "company_name", "customer_type"],
              })
            : null,
          lookupStaffName(models, userId),
        ]);
        const customerName = formatCustomerDisplay(customer);
        const eventKey = is_refund ? "payment_voided" : "payment_received";
        const label = is_refund ? "Refund" : "Payment";
        await notifyEvent(models, eventKey, {
          amount: numeric,
          actorUserId: userId,
          customerName,
          vars: {
            invoice_no: String(invoiceId),
            amount: numeric,
            customer: customerName,
            staff: staffName,
            date: new Date(),
            time: new Date(),
          },
          title: `${label} on #${invoiceId} · LKR ${formatLkr(numeric)}`,
          body: `${customerName} · ${method || "Cash"} · by ${staffName}`,
          titleNoAmount: `${label} recorded on #${invoiceId}`,
          bodyNoAmount: `${customerName} · ${method || "Cash"} · by ${staffName}`,
          data: { type: eventKey, invoice_id: String(invoiceId) },
          link: "/invoices?mode=manage",
        });
      } catch {
        // Push failures must never affect payment recording
      }
    })();
  }

  return payment;
};

// --- 6. VAULT STATUS TOGGLE ---
export const toggleVaultStatus = async (models, invoiceId, userId) => {
  return await models.sequelize.transaction(async (t) => {
    const invoice = await models.Invoice.findByPk(invoiceId, {
      include: [models.Customer],
      transaction: t,
    });
    if (!invoice) throw new AppError("Invoice not found", 404);

    const customer = invoice.Customer;
    const isCurrentlyRetained = customer ? Boolean(customer.is_id_retained_currently) : false;
    const newStatus = !isCurrentlyRetained;

    if (customer) {
      await customer.update(
        { is_id_retained_currently: newStatus },
        { transaction: t },
      );
    }
    await invoice.update(
      { id_card_status: newStatus ? 1 : 0 },
      { transaction: t },
    );

    await models.InvoiceTrace.create(
      {
        invoice_id: invoiceId,
        actor_user_id: userId,
        event_category: "SECURITY",
        event_action: newStatus ? "ID_RETAINED" : "ID_RELEASED",
        comments: `Physical ID Card was ${newStatus ? "retained in vault" : "released to customer"}.`,
      },
      { transaction: t },
    );

    await touchCustomerBrief(models, invoice.customer_id, { transaction: t });

    if (newStatus === false) {
      const paid =
        Number(
          await models.Payment?.sum?.("payment_amount", {
            where: { invoice_id: invoiceId, is_voided: false },
            transaction: t,
          }),
        ) || 0;
      const balance = Math.round((liveTotalOf(invoice) - paid) * 100) / 100;
      if (balance > BALANCE_TOLERANCE) {
        await maybeRecordActivity(
          models,
          {
            type: "id_card_released_unpaid",
            invoice_id: invoiceId,
            customer_id: invoice.customer_id,
            actor_user_id: userId,
            amount: balance,
            data: { balance },
          },
          { transaction: t },
        );
      }
    }

    return {
      is_id_retained_currently: newStatus,
      id_card_status: newStatus ? 1 : 0,
    };
  });
};
// --- 7. DYNAMIC FEE ADJUSTMENT ---
export const updateInvoiceFees = async (models, invoiceId, payload, userId) => {
  return await models.sequelize.transaction(async (t) => {
    const invoice = await models.Invoice.findByPk(invoiceId, {
      transaction: t,
    });
    if (!invoice) throw new AppError("Invoice not found", 404);
    // the discount is usually agreed mid-rental or at handover, so fees stay editable until completion
    assertNotCompleted(invoice, "change the discount or transport of");

    const oldTransport = Number(invoice.transport_fee) || 0;
    const oldDiscount = Number(invoice.discount_amount) || 0;
    const newTransport =
      payload.transport_fee !== undefined
        ? Number(payload.transport_fee) || 0
        : oldTransport;
    const newDiscount =
      payload.discount_amount !== undefined
        ? Number(payload.discount_amount) || 0
        : oldDiscount;

    if (newTransport < 0 || newDiscount < 0) throw new AppError("Discount and transport cannot be negative.", 400);

    let validatedDiscountReason = null;
    const discountChanged = payload.discount_amount !== undefined && newDiscount !== oldDiscount;
    if (discountChanged && newDiscount > 0) {
      validatedDiscountReason = await validateReason(models, "discount", payload.discount_reason, { transaction: t });
    }

    // Recalculate the Grand Total with the new fees
    const newTotal =
      Number(invoice.total_amount) -
      oldTransport +
      oldDiscount +
      newTransport -
      newDiscount;

    if (newTotal < 0) throw new AppError("The discount cannot be larger than the invoice total.", 400);

    // A change of discount falls on the rental part only: goods keep the discount shares they were
    // sold with, so sale_total never moves after the sale. (Sale-only bills have no rental part.)
    const kind = invoice.bill_kind || "rental";
    const rentalPart = {};
    if (kind === "rental" || kind === "mixed") {
      const newRentalTotal =
        Math.round((Number(invoice.rental_total || 0) - (newDiscount - oldDiscount)) * 100) / 100;
      if (kind === "mixed" && newRentalTotal < 0) {
        throw new AppError("The discount is more than what is left of the rental part of this bill.", 409);
      }
      rentalPart.rental_total = Math.max(0, newRentalTotal);
    } else if (kind === "sale") {
      // A sale-only bill has only goods, so the discount change moves the goods total with it.
      const newSaleTotal =
        Math.round((Number(invoice.sale_total || 0) - (newDiscount - oldDiscount)) * 100) / 100;
      if (newSaleTotal < 0) throw new AppError("The discount cannot be larger than the goods on this bill.", 409);
      rentalPart.sale_total = newSaleTotal;
    }

    await invoice.update(
      {
        transport_fee: newTransport,
        discount_amount: newDiscount,
        total_amount: newTotal,
        ...rentalPart,
        ...(discountChanged
          ? {
              discount_reason_key: newDiscount > 0 ? validatedDiscountReason.key : null,
              discount_reason_note: newDiscount > 0 ? validatedDiscountReason.note : null,
            }
          : {}),
      },
      { transaction: t },
    );

    // Leave a paper trail!
    await models.InvoiceTrace.create(
      {
        invoice_id: invoiceId,
        actor_user_id: userId,
        event_category: "FINANCE",
        event_action: "FEES_UPDATED",
        comments: `Fees adjusted. Transport: Rs.${newTransport}, Discount: Rs.${newDiscount}.`,
        state_payload: {
          transport_fee: newTransport,
          discount_amount: newDiscount,
          ...(validatedDiscountReason ? { discount_reason: validatedDiscountReason } : {}),
        },
      },
      { transaction: t },
    );

    await touchCustomerBrief(models, invoice.customer_id, { transaction: t });

    if (discountChanged && newDiscount > 0 && validatedDiscountReason) {
      const printCount = models.InvoicePrintLog?.count
        ? await models.InvoicePrintLog.count({ where: { invoice_id: invoiceId }, transaction: t })
        : 0;
      const raisedAfterPrinting = printCount > 0 && newDiscount > oldDiscount;
      const baseTotal = Number(invoice.sub_total || 0) + newTransport;
      const discountPct = baseTotal > 0 ? Math.round((newDiscount / baseTotal) * 10000) / 100 : 0;

      await maybeRecordActivity(
        models,
        {
          type: "discount",
          invoice_id: invoiceId,
          customer_id: invoice.customer_id,
          actor_user_id: userId,
          amount: newDiscount,
          data: {
            old_amount: oldDiscount,
            new_amount: newDiscount,
            discount_pct: discountPct,
            raised_after_printing: raisedAfterPrinting,
            reason_key: validatedDiscountReason.key,
            reason_note: validatedDiscountReason.note,
            reason_label_en: validatedDiscountReason.label_en,
            reason_label_si: validatedDiscountReason.label_si,
          },
        },
        { transaction: t },
      );
    }

    return invoice;
  });
};

const redactAmounts = (text) =>
  String(text || "")
    .replace(/Rs\.?\s*[\d,]+(?:\.\d{1,2})?/gi, "Rs —")
    .replace(/රු\.?\s*[\d,]+(?:\.\d{1,2})?/g, "රු. —");

const formatTraceSentence = (trace, actorName, canSeeMoney) => {
  const cat = String(trace.event_category || "").toUpperCase();
  const act = String(trace.event_action || "").toUpperCase();
  const payload = parseJsonField(trace.state_payload, {});
  const who = actorName || "Staff";
  const amt = payload?.amount ?? payload?.payment_amount ?? payload?.discount_amount;
  const amtEn = canSeeMoney && amt != null ? ` Rs ${formatLkr(amt)}` : "";
  const amtSi = canSeeMoney && amt != null ? ` රු. ${formatLkr(amt)}` : "";

  if (cat === "INVOICE" && act === "CREATED") {
    return {
      sentence_en: `Bill created by ${who}`,
      sentence_si: `${who} විසින් බිල්පත සාදන ලදී`,
    };
  }
  if (cat === "PAYMENT" && act === "ADDED") {
    return {
      sentence_en: `Payment${amtEn} recorded by ${who}`,
      sentence_si: `${who} විසින් ගෙවීම${amtSi} සටහන් කරන ලදී`,
    };
  }
  if (cat === "PAYMENT" && act === "VOIDED") {
    return {
      sentence_en: `Payment${amtEn} voided by ${who}`,
      sentence_si: `${who} විසින් ගෙවීම${amtSi} අවලංගු කරන ලදී`,
    };
  }
  if (cat === "RETURN" && act === "PROCESSED") {
    return {
      sentence_en: `Equipment returned (${who})`,
      sentence_si: `උපකරණ ආපසු භාර ගන්නා ලදී (${who})`,
    };
  }
  if (cat === "FEES" && act === "UPDATED") {
    return {
      sentence_en: `Fees or discount updated by ${who}`,
      sentence_si: `${who} විසින් ගාස්තු හෝ වට්ටම් යාවත්කාලීන කරන ලදී`,
    };
  }
  if (cat === "INVOICE" && act === "DELETED") {
    return {
      sentence_en: `Bill deleted by ${who}`,
      sentence_si: `${who} විසින් බිල්පත මකා දමන ලදී`,
    };
  }
  if (cat === "INVOICE" && act === "RESTORED") {
    return {
      sentence_en: `Bill restored by ${who}`,
      sentence_si: `${who} විසින් බිල්පත ප්‍රතිසාධනය කරන ලදී`,
    };
  }
  if (cat === "INVOICE" && act === "COMPLETED") {
    return {
      sentence_en: `Bill completed by ${who}`,
      sentence_si: `${who} විසින් බිල්පත සම්පූර්ණ කරන ලදී`,
    };
  }
  if (cat === "INVOICE" && act === "REOPENED") {
    return {
      sentence_en: `Bill reopened by ${who}`,
      sentence_si: `${who} විසින් බිල්පත නැවත විවෘත කරන ලදී`,
    };
  }
  const fallback = trace.comments ? String(trace.comments) : `${cat} ${act} (${who})`;
  const safeFallback = canSeeMoney ? fallback : redactAmounts(fallback);
  return { sentence_en: safeFallback, sentence_si: safeFallback };
};

/** Complete bill summary for a paired phone (role money-visibility enforced). */
export const getDeviceInvoiceSummary = async (models, device, invoiceId) => {
  const user =
    device?.user_id && models?.User?.findByPk
      ? await models.User.findByPk(device.user_id, {
          attributes: ["user_id", "is_active"],
          include: models.Role
            ? [
                {
                  model: models.Role,
                  attributes: ["role_id", "role_name", "hierarchy_level", "is_active"],
                  through: { attributes: [] },
                  ...(models.Permission
                    ? {
                        include: [
                          {
                            model: models.Permission,
                            attributes: ["permission_code"],
                            through: { attributes: [] },
                          },
                        ],
                      }
                    : {}),
                },
              ]
            : [],
        })
      : null;

  const isAdmin = isUserAdmin(user);
  const canViewBill = isAdmin || (await userHasPermission(models, user, "invoice:view"));
  if (!canViewBill) {
    throw new AppError("You do not have permission to view bill summaries on a phone.", 403);
  }

  let canSeeMoney = true;
  if (!isAdmin) {
    try {
      const roleIds = (user?.Roles || [])
        .filter((r) => r.is_active !== false)
        .map((r) => r.role_id);
      const vis = await resolveUserActivityVisibility(models, device?.user_id, roleIds);
      canSeeMoney = vis.seeAmounts !== false;
    } catch {
      canSeeMoney = true;
    }
  }

  try {
    await refreshAccruals(models, { invoiceIds: [invoiceId] });
  } catch {
    // Non-fatal in minimal mock environments
  }

  const invoiceFinder = models.Invoice?.unscoped ? models.Invoice.unscoped() : models.Invoice;
  const invoice = await invoiceFinder.findByPk(invoiceId, {
    include: [
      ...(models.Customer ? [{ model: models.Customer }] : []),
      ...(models.InvoiceLine
        ? [
            {
              model: models.InvoiceLine,
              include: models.Equipment
                ? [{ model: models.Equipment, attributes: ["equipment_name"] }]
                : [],
            },
          ]
        : []),
      ...(models.InvoiceSaleLine
        ? [
            {
              model: models.InvoiceSaleLine,
              required: false,
            },
          ]
        : []),
      ...(models.Payment ? [{ model: models.Payment }] : []),
      ...(models.User
        ? [
            {
              model: models.User,
              attributes: ["user_id", "first_name", "last_name", "username"],
              required: false,
            },
          ]
        : []),
    ],
  });

  if (!invoice) {
    throw new AppError("Invoice not found.", 404);
  }

  const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const total_amount = liveTotalOf(invoice);
  const allPayments = invoice.Payments || [];
  const activePayments = allPayments.filter((p) => !p.is_voided);
  const paid_amount = Math.max(
    0,
    round2(activePayments.reduce((s, p) => s + Number(p.payment_amount || 0), 0)),
  );
  const balance_due = owedAmount(total_amount, activePayments);
  const returned_amount = round2(
    activePayments
      .filter((p) => Number(p.payment_amount || 0) < 0)
      .reduce((s, p) => s + Math.abs(Number(p.payment_amount || 0)), 0),
  );

  const issuer = invoice.User || null;
  const issued_by = issuer
    ? `${issuer.first_name || ""} ${issuer.last_name || ""}`.trim() || issuer.username || null
    : null;

  const rentalLines = invoice.InvoiceLines || [];
  const saleLinesRaw = invoice.InvoiceSaleLines || [];
  const sale_lines = saleLinesRaw.map((sl) => ({
    line_id: sl.sale_line_id ?? sl.line_id ?? null,
    name: sl.item_name || sl.Equipment?.equipment_name || "Item",
    quantity: Number(sl.quantity || 0),
    unit: sl.unit || null,
    unit_price: canSeeMoney ? round2(sl.unit_price || 0) : null,
    line_total: canSeeMoney ? round2(sl.line_total_amount || 0) : null,
    returned_qty: Number(sl.returned_qty || 0),
  }));

  const bill_kind =
    rentalLines.length > 0 && sale_lines.length > 0
      ? "mixed"
      : sale_lines.length > 0 && rentalLines.length === 0
        ? "sale"
        : "rental";

  const now = new Date();
  const issuedAt = new Date(invoice.issued_date || invoice.createdAt || now);
  const createdAt = invoice.createdAt ? new Date(invoice.createdAt) : issuedAt;
  const dayDiff = (a, b) => {
    const da = new Date(a);
    const db = new Date(b);
    if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
    const utcA = Date.UTC(da.getUTCFullYear(), da.getUTCMonth(), da.getUTCDate());
    const utcB = Date.UTC(db.getUTCFullYear(), db.getUTCMonth(), db.getUTCDate());
    return Math.max(0, Math.round((utcB - utcA) / 86_400_000));
  };

  // Staff name lookup cache for payments, traces, activities, and calls
  const staffIds = new Set();
  for (const p of allPayments) {
    if (p.received_by_user_id) staffIds.add(Number(p.received_by_user_id));
  }

  let traces = [];
  if (models.InvoiceTrace?.findAll) {
    try {
      traces = await models.InvoiceTrace.findAll({
        where: { invoice_id: invoiceId },
        order: [["occurred_at", "DESC"]],
        limit: 100,
      });
      for (const tr of traces) {
        if (tr.actor_user_id) staffIds.add(Number(tr.actor_user_id));
      }
    } catch {
      traces = [];
    }
  }

  let activities = [];
  if (models.ActivityEvent?.findAll) {
    try {
      activities = await models.ActivityEvent.findAll({
        where: { invoice_id: invoiceId },
        order: [["occurred_at", "DESC"]],
        limit: 100,
      });
      for (const ev of activities) {
        if (ev.actor_user_id) staffIds.add(Number(ev.actor_user_id));
        if (ev.checked_by) staffIds.add(Number(ev.checked_by));
      }
    } catch {
      activities = [];
    }
  }

  let calls = [];
  if (models.CallLog?.findAll && invoice.customer_id) {
    try {
      const recentCalls = await models.CallLog.findAll({
        where: { customer_id: invoice.customer_id },
        include: models.CallNote ? [{ model: models.CallNote, required: false }] : [],
        order: [["started_at", "DESC"]],
        limit: 30,
      });
      for (const c of recentCalls) {
        const logIds = parseJsonField(c.invoice_ids, []);
        const notes = Array.isArray(c.CallNotes) ? c.CallNotes : c.CallNote ? [c.CallNote] : [];
        const note = notes[0] || null;
        const noteIds = note ? parseJsonField(note.invoice_ids, []) : [];
        const matchesInvoice =
          (Array.isArray(logIds) && logIds.map(Number).includes(Number(invoiceId))) ||
          (Array.isArray(noteIds) && noteIds.map(Number).includes(Number(invoiceId)));
        if (matchesInvoice) {
          if (c.user_id) staffIds.add(Number(c.user_id));
          if (note?.user_id) staffIds.add(Number(note.user_id));
          calls.push({ c, note });
        }
      }
    } catch {
      calls = [];
    }
  }

  const staffNameMap = new Map();
  if (staffIds.size > 0 && models.User?.findAll) {
    try {
      const users = await models.User.findAll({
        where: { user_id: { [Op.in]: [...staffIds] } },
        attributes: ["user_id", "first_name", "last_name", "username"],
      });
      for (const u of users) {
        const name = `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username || "Staff";
        staffNameMap.set(Number(u.user_id), name);
      }
    } catch {
      // Non-fatal
    }
  }

  const payments = allPayments
    .map((p) => {
      const amt = round2(p.payment_amount || 0);
      return {
        payment_id: p.payment_id ?? null,
        amount: canSeeMoney ? amt : null,
        method: p.method || "Cash",
        payment_date: p.payment_date ? new Date(p.payment_date).toISOString() : null,
        entered_at: p.entered_at
          ? new Date(p.entered_at).toISOString()
          : p.payment_date
            ? new Date(p.payment_date).toISOString()
            : null,
        staff_name: p.received_by_user_id ? staffNameMap.get(Number(p.received_by_user_id)) || null : null,
        is_voided: Boolean(p.is_voided),
        is_refund: amt < 0,
        settlement_id: p.settlement_id ?? null,
      };
    })
    .sort((a, b) => new Date(b.payment_date || 0).getTime() - new Date(a.payment_date || 0).getTime());

  const settlement_id =
    payments.find((p) => p.settlement_id != null)?.settlement_id ??
    rentalLines.find((l) => l.settlement_id != null)?.settlement_id ??
    null;

  const historyFromActivities = activities.map((ev) => {
    const data = parseJsonField(ev.data, {});
    const rawSentence =
      data.sentence && typeof data.sentence === "object"
        ? data.sentence
        : { en: String(data.sentence || ev.type), si: String(data.sentence || ev.type) };
    const en = canSeeMoney ? String(rawSentence.en || ev.type) : redactAmounts(rawSentence.en || ev.type);
    const si = canSeeMoney ? String(rawSentence.si || en) : redactAmounts(rawSentence.si || en);
    return {
      id: `act-${ev.event_id}`,
      source: "activity",
      type: ev.type,
      sentence_en: en,
      sentence_si: si,
      occurred_at: new Date(ev.occurred_at || ev.created_at || Date.now()).toISOString(),
      actor_name: ev.actor_user_id ? staffNameMap.get(Number(ev.actor_user_id)) || null : null,
      risk: ev.risk || "normal",
      checked_at: ev.checked_at ? new Date(ev.checked_at).toISOString() : null,
      checked_by_name: ev.checked_by ? staffNameMap.get(Number(ev.checked_by)) || null : null,
    };
  });

  const historyFromTraces = traces.map((tr) => {
    const actorName = tr.actor_user_id ? staffNameMap.get(Number(tr.actor_user_id)) || "Staff" : "Staff";
    const { sentence_en, sentence_si } = formatTraceSentence(tr, actorName, canSeeMoney);
    return {
      id: `trace-${tr.trace_id}`,
      source: "trace",
      type: `${tr.event_category || ""}_${tr.event_action || ""}`.toLowerCase(),
      sentence_en,
      sentence_si,
      occurred_at: new Date(tr.occurred_at || tr.createdAt || Date.now()).toISOString(),
      actor_name: actorName,
      risk: "normal",
      checked_at: null,
      checked_by_name: null,
    };
  });

  const history = [...historyFromActivities, ...historyFromTraces].sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
  );

  const items_amount = round2(
    saleLinesRaw.reduce((s, sl) => s + Number(sl.line_total_amount || 0), 0),
  );
  const rent_amount = round2(Number(invoice.sub_total || 0) + Number(invoice.accrued_rental || 0));
  const late_fees = round2(
    Math.max(0, Number(invoice.accrued_charges || 0) - Number(invoice.accrued_rental || 0)),
  );

  const backdatedEv = activities.find((ev) => ev.type === "backdated_bill");
  const backdatedEvDays = backdatedEv ? Number(parseJsonField(backdatedEv.data, {})?.days_back || 0) : 0;
  const backdated_days = backdatedEvDays > 0 ? backdatedEvDays : dayDiff(issuedAt, createdAt);

  return {
    invoice_id: Number(invoice.invoice_id),
    invoice_number: `INV-${invoice.invoice_id}`,
    status: invoice.is_deleted ? "Deleted" : String(invoice.status || ""),
    is_deleted: Boolean(invoice.is_deleted),
    bill_kind,
    issued_at: issuedAt.toISOString(),
    created_at: createdAt.toISOString(),
    backdated_days,
    can_see_money: canSeeMoney,
    customer: {
      customer_id: invoice.Customer?.customer_id ?? invoice.customer_id ?? null,
      name: formatCustomerDisplay(invoice.Customer),
      phone: invoice.Customer?.phone_number ?? null,
      is_walk_in: Boolean(invoice.Customer?.is_walk_in || (!invoice.Customer && !invoice.customer_id)),
      id_card_status: Number(invoice.id_card_status || 0),
    },
    items: rentalLines.map((line) => {
      const stillOut =
        !line.actual_return_date &&
        String(line.line_status || "").toLowerCase() !== "returned";
      const days_late =
        stillOut && line.expected_return_date
          ? Math.max(0, wholeDaysBetween(new Date(line.expected_return_date), now))
          : 0;
      return {
        line_id: line.line_id ?? null,
        name: line.Equipment?.equipment_name || `Equipment #${line.equipment_id}`,
        quantity: Number(line.borrow_quantity || 0),
        borrow_date: line.borrow_date ?? null,
        expected_return_date: line.expected_return_date ?? null,
        actual_return_date: line.actual_return_date ?? null,
        good_returned_qty: Number(line.good_returned_qty || 0),
        defective_returned_qty: Number(line.defective_returned_qty || 0),
        line_status: line.line_status || "Active",
        days_late,
        line_total: canSeeMoney
          ? round2(Number(line.line_total_amount || 0) + Number(line.accrued_charge || 0))
          : null,
      };
    }),
    sale_lines,
    total_amount: canSeeMoney ? total_amount : null,
    paid_amount: canSeeMoney ? paid_amount : null,
    balance_due: canSeeMoney ? balance_due : null,
    rent_amount: canSeeMoney ? rent_amount : null,
    items_amount: canSeeMoney ? items_amount : null,
    transport_fee: canSeeMoney ? round2(invoice.transport_fee || 0) : null,
    discount_amount: canSeeMoney ? round2(invoice.discount_amount || 0) : null,
    discount_reason_key: invoice.discount_reason_key ?? null,
    discount_reason_note: invoice.discount_reason_note ?? null,
    late_fees: canSeeMoney ? late_fees : null,
    returned_amount: canSeeMoney ? returned_amount : null,
    payments,
    settlement_id,
    calls: calls.map(({ c, note }) => ({
      call_id: c.call_id,
      started_at: c.started_at ? new Date(c.started_at).toISOString() : null,
      duration_seconds: Number(c.duration_seconds || 0),
      direction: c.direction || "OUTGOING",
      outcome: note?.outcome ?? null,
      result: note?.result ?? null,
      note: note?.note ?? null,
      staff_name:
        (note?.user_id && staffNameMap.get(Number(note.user_id))) ||
        (c.user_id && staffNameMap.get(Number(c.user_id))) ||
        null,
    })),
    history,
    issued_by,
  };
};
