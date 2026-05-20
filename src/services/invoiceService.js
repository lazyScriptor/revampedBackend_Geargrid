import { Op } from "sequelize";
import AppError from "../utils/AppError.js";

// --- 1. DISPATCH ENGINE (With Row-Level Locks) ---
export const createDispatchInvoice = async (models, payload, userId) => {
  const { customer_id, items, fees } = payload;

  return await models.sequelize.transaction(async (t) => {
    let subTotal = 0;

    // Validate basics
    if (!items || items.length === 0)
      throw new AppError("Invoice must contain at least one item.", 400);

    const invoiceLinesData = items.map((item) => {
      const start = new Date(item.borrow_date).getTime();
      const end = new Date(item.expected_return_date).getTime();
      let totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      if (totalDays < 1 || isNaN(totalDays)) totalDays = 1;

      let lineTotal = 0;
      if (totalDays <= item.locked_minimum_days) {
        lineTotal = item.locked_base_price * item.borrow_quantity;
      } else {
        const extraDays = totalDays - item.locked_minimum_days;
        lineTotal =
          (item.locked_base_price + extraDays * item.locked_extra_daily_rate) *
          item.borrow_quantity;
      }
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

    const newInvoice = await models.Invoice.create(
      {
        customer_id,
        issued_by_user_id: userId,
        total_amount: grandTotal,
        advance_paid: fees.advance || 0,
        transport_fee: fees.transport || 0,
        discount_amount: fees.discount || 0,
        sub_total: subTotal,
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

    if (fees.advance > 0) {
      await models.Payment.create(
        {
          invoice_id: newInvoice.invoice_id,
          payment_amount: fees.advance,
          method: "Cash",
        },
        { transaction: t },
      );

      const customer = await models.Customer.findByPk(customer_id, {
        transaction: t,
      });
      if (customer && customer.deposit_balance > 0) {
        const newBalance = Math.max(0, customer.deposit_balance - fees.advance);
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
        comments: `Invoice generated for ${items.length} items. Total: Rs. ${grandTotal}.`,
        state_payload: { items, fees },
      },
      { transaction: t },
    );

    return newInvoice;
  });
};

// --- 2. GLOBAL SEARCH ENGINE ---
export const getAllInvoices = async (models, queryParams) => {
  const page = parseInt(queryParams.page) || 1;
  const limit = parseInt(queryParams.limit) || 20;
  const offset = (page - 1) * limit;

  const whereClause = {};
  const customerWhereClause = {};

  if (queryParams.search) {
    const searchTerm = queryParams.search;
    const searchLike = `%${searchTerm}%`;

    if (!isNaN(searchTerm)) {
      whereClause.invoice_id = searchTerm;
    } else {
      customerWhereClause[Op.or] = [
        { first_name: { [Op.like]: searchLike } },
        { last_name: { [Op.like]: searchLike } },
        { phone_number: { [Op.like]: searchLike } },
        { nic_number: { [Op.like]: searchLike } },
        { company_name: { [Op.like]: searchLike } },
      ];
    }
  }

  if (queryParams.status) whereClause.status = queryParams.status;

  const { count, rows } = await models.Invoice.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: models.Customer,
        where:
          Object.keys(customerWhereClause).length > 0
            ? customerWhereClause
            : undefined,
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
        model: models.InvoiceLine,
        include: [
          {
            model: models.Equipment,
            attributes: ["equipment_name", "is_bulk_item"],
          },
        ],
      },
      {
        model: models.Payment,
        attributes: ["payment_id", "payment_amount", "payment_date", "method"],
      },
      { model: models.InvoiceTrace },
    ],
    limit,
    offset,
    order: [["issued_date", "DESC"]],
  });

  return { totalItems: count, invoices: rows };
};

// --- 3. GET SINGLE INVOICE DETAILS ---
export const getInvoiceById = async (models, invoiceId) => {
  const invoice = await models.Invoice.findByPk(invoiceId, {
    include: [
      { model: models.Customer },
      {
        model: models.InvoiceLine,
        include: [
          {
            model: models.Equipment,
            attributes: ["equipment_name", "is_bulk_item"],
          },
        ],
      },
      { model: models.Payment },
      { model: models.InvoiceTrace },
    ],
    order: [[models.InvoiceTrace, "createdAt", "DESC"]],
  });

  if (!invoice) throw new AppError("Invoice not found", 404);
  return invoice;
};

// --- 4. CONTINUOUS RETURN ENGINE (Partial Return Logic Upgraded) ---
export const processReturn = async (models, payload, userId) => {
  const {
    invoice_id,
    lines_returned,
    final_payment_amount,
    release_id_card,
    payment_method,
  } = payload;

  return await models.sequelize.transaction(async (t) => {
    const invoice = await models.Invoice.findByPk(invoice_id, {
      transaction: t,
    });
    if (!invoice || invoice.status === "Completed")
      throw new AppError("Invoice not found or already completed.", 400);

    let totalLateFees = 0;

    for (const returnData of lines_returned) {
      // 1. Lock the specific invoice line
      const line = await models.InvoiceLine.findByPk(returnData.line_id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!line)
        throw new AppError(`Line item ${returnData.line_id} not found.`, 404);

      const goodQty = parseInt(returnData.good_qty) || 0;
      const badQty = parseInt(returnData.defective_qty) || 0;
      const totalReturnedNow = goodQty + badQty;

      // Skip processing if they aren't returning anything for this specific line today
      if (totalReturnedNow <= 0) continue;

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

      const expectedDate = new Date(line.expected_return_date).getTime();
      const actualDate = new Date(returnData.actual_return_date).getTime();
      const daysLate = overdueEnabled
        ? Math.max(0, Math.ceil((actualDate - expectedDate) / (1000 * 60 * 60 * 24)))
        : 0;

      let lineLateFee = 0;
      if (daysLate > 0) {
        lineLateFee =
          daysLate * line.locked_extra_daily_rate * totalReturnedNow;
        totalLateFees += lineLateFee;
      }

      // 4. Update the Line Item Stats cumulatively
      const newGoodTotal = line.good_returned_qty + goodQty;
      const newBadTotal = line.defective_returned_qty + badQty;
      const newGrandTotalReturned = newGoodTotal + newBadTotal;

      // If they returned everything, close the line. If not, keep it "Active"
      const newLineStatus =
        newGrandTotalReturned >= line.borrow_quantity ? "Returned" : "Active";

      // If the caller explicitly waived overdue for this line, persist it so
      // future partial-return settlements on the same line are also fee-free.
      const updatedTrackOverdue =
        returnData.track_overdue === false ? false : line.track_overdue;

      await line.update(
        {
          actual_return_date: returnData.actual_return_date,
          good_returned_qty: newGoodTotal,
          defective_returned_qty: newBadTotal,
          line_total_amount: Number(line.line_total_amount) + lineLateFee,
          line_status: newLineStatus,
          track_overdue: updatedTrackOverdue,
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

    // 5. Settle Finance and Master Invoice Status
    const newGrandTotal = Number(invoice.total_amount) + totalLateFees;

    if (final_payment_amount > 0) {
      await models.Payment.create(
        {
          invoice_id,
          payment_amount: final_payment_amount,
          method: payment_method || "Cash",
        },
        { transaction: t },
      );
    }

    // If ANY line item is still "Active" (partially returned), the Invoice stays "Active"
    const activeLinesCount = await models.InvoiceLine.count({
      where: { invoice_id, line_status: "Active" },
      transaction: t,
    });
    const finalStatus = activeLinesCount === 0 ? "Completed" : "Active";

    await invoice.update(
      {
        total_amount: newGrandTotal,
        status: finalStatus,
        id_card_status: release_id_card ? 0 : invoice.id_card_status,
      },
      { transaction: t },
    );

    if (release_id_card) {
      await models.Customer.update(
        { is_id_retained_currently: false },
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
        state_payload: { lines_returned },
      },
      { transaction: t },
    );

    return true;
  });
};

// --- 5. CONTINUOUS PAYMENTS & REFUNDS ---
export const addContinuousPayment = async (
  models,
  invoiceId,
  payload,
  userId,
) => {
  const { amount, method, is_refund } = payload;
  const actualAmount = is_refund ? -Math.abs(amount) : Math.abs(amount);

  return await models.sequelize.transaction(async (t) => {
    const invoice = await models.Invoice.findByPk(invoiceId, {
      transaction: t,
    });
    if (!invoice) throw new AppError("Invoice not found", 404);

    const payment = await models.Payment.create(
      {
        invoice_id: invoiceId,
        payment_amount: actualAmount,
        method: method || "Cash",
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

    return payment;
  });
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
    const isCurrentlyRetained = customer.is_id_retained_currently;
    const newStatus = !isCurrentlyRetained;

    await customer.update(
      { is_id_retained_currently: newStatus },
      { transaction: t },
    );
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

    return newStatus;
  });
};
// --- 7. DYNAMIC FEE ADJUSTMENT ---
export const updateInvoiceFees = async (models, invoiceId, payload, userId) => {
  return await models.sequelize.transaction(async (t) => {
    const invoice = await models.Invoice.findByPk(invoiceId, {
      transaction: t,
    });
    if (!invoice) throw new AppError("Invoice not found", 404);

    const oldTransport = Number(invoice.transport_fee);
    const oldDiscount = Number(invoice.discount_amount);
    const newTransport = Number(payload.transport_fee) || 0;
    const newDiscount = Number(payload.discount_amount) || 0;

    // Recalculate the Grand Total with the new fees
    const newTotal =
      Number(invoice.total_amount) -
      oldTransport +
      oldDiscount +
      newTransport -
      newDiscount;

    await invoice.update(
      {
        transport_fee: newTransport,
        discount_amount: newDiscount,
        total_amount: newTotal,
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
        },
      },
      { transaction: t },
    );

    return invoice;
  });
};
